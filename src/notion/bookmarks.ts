import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaStore } from './media';
import type { BookmarkMeta, MediaRef } from './types';

const USER_AGENT = 'lil.horse-build/1.0 (+https://lil.horse)';
const MAX_HTML_BYTES = 512 * 1024;
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: '\u00a0',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const name = entity.toLowerCase();
    if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
    if (!name.startsWith('#')) return match;
    const codePoint = name.startsWith('#x')
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  // The lookbehind keeps this linear when a long name has no "=".
  for (const match of tag.matchAll(
    /(?<![a-zA-Z:-])([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const name = match[1]?.toLowerCase();
    if (name) result[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function httpUrl(value: string | undefined, base?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function iconLinks(html: string, baseUrl: string): string[] {
  const icons: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const href = httpUrl(attrs.href, baseUrl);
    if (
      href &&
      !icons.includes(href) &&
      /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(attrs.rel ?? '')
    )
      icons.push(href);
  }
  return icons;
}

export function parseHead(html: string, baseUrl: string) {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title:
      meta.get('og:title') ||
      meta.get('twitter:title') ||
      (titleTag ? decodeEntities(titleTag).trim() : null) ||
      null,
    description: meta.get('og:description') || meta.get('description') || null,
    siteName: meta.get('og:site_name') || null,
    image: httpUrl(meta.get('og:image') || meta.get('twitter:image'), baseUrl),
    icon: iconLinks(html, baseUrl).at(0) ?? null,
  };
}

function charsetParam(value: string | null | undefined): string | undefined {
  return /charset\s*=\s*["']?([\w.:-]+)/i.exec(value ?? '')?.[1];
}

function decoderFor(label: string | undefined): TextDecoder | null {
  if (!label) return null;
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

function metaCharset(bytes: Uint8Array): string | undefined {
  const prescan = new TextDecoder('windows-1252').decode(bytes.subarray(0, 1024));
  for (const tag of prescan.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const label =
      attrs.charset ??
      (attrs['http-equiv']?.toLowerCase() === 'content-type'
        ? charsetParam(attrs.content)
        : undefined);
    if (label) return label;
  }
  return undefined;
}

function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder().decode(bytes);
  const declared = decoderFor(charsetParam(contentType));
  if (declared) return declared.decode(bytes);
  const sniffed = decoderFor(metaCharset(bytes));
  // An ASCII-compatible prescan found the label, so the page can't really be UTF-16.
  if (sniffed && !sniffed.encoding.startsWith('utf-16')) return sniffed.decode(bytes);
  return new TextDecoder().decode(bytes);
}

async function readHtmlBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length <= MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    chunks.push(value);
    length += value.byteLength;
  }
  await reader.cancel();
  return Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES);
}

function readable(text: string | null): string | null {
  return text?.includes('\ufffd') ? null : text;
}

function redact(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

interface CachedBookmark {
  fetchedAt: number;
  meta: BookmarkMeta;
}

export interface BookmarkFetcherOptions {
  cacheDir: string;
  media: MediaStore;
  fetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
  warn?: (message: string) => void;
}

export class BookmarkFetcher {
  readonly #cacheDir: string;
  readonly #media: MediaStore;
  readonly #fetch: typeof fetch;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #warn: (message: string) => void;
  readonly #pending = new Map<string, Promise<BookmarkMeta | null>>();

  constructor(options: BookmarkFetcherOptions) {
    this.#cacheDir = options.cacheDir;
    this.#media = options.media;
    this.#fetch = options.fetch ?? fetch;
    this.#ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#warn = options.warn ?? (() => undefined);
  }

  get(url: string): Promise<BookmarkMeta | null> {
    const pending = this.#pending.get(url);
    if (pending) return pending;
    const task = this.#get(url).finally(() => this.#pending.delete(url));
    this.#pending.set(url, task);
    return task;
  }

  async #get(url: string): Promise<BookmarkMeta | null> {
    if (!httpUrl(url)) {
      this.#warn(`Bookmark metadata unavailable for ${url}: not an http(s) URL`);
      return null;
    }
    const file = join(
      this.#cacheDir,
      `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`,
    );
    const cached = await this.#read(file);
    const missing = (ref: MediaRef | null) => ref !== null && !this.#media.has(ref.key);
    if (
      cached &&
      this.#now() - cached.fetchedAt < this.#ttlMs &&
      !missing(cached.meta.image) &&
      !missing(cached.meta.icon)
    )
      return cached.meta;

    const page = await this.#fetchPage(url).catch((error: unknown) => {
      this.#warn(`Bookmark metadata unavailable for ${url}: ${reason(error)}`);
      return null;
    });
    if (!page) {
      if (!cached) return null;
      const { image, icon } = cached.meta;
      return {
        ...cached.meta,
        image: missing(image) ? null : image,
        icon: missing(icon) ? null : icon,
      };
    }

    const meta: BookmarkMeta = {
      title: readable(page.head.title),
      description: readable(page.head.description),
      siteName: readable(page.head.siteName),
      image: await this.#download(url, 'image', page.head.image ? [page.head.image] : []),
      icon: await this.#download(url, 'icon', page.icons),
    };
    try {
      await this.#write(file, { fetchedAt: this.#now(), meta });
    } catch (error) {
      this.#warn(`Could not cache bookmark metadata for ${url}: ${reason(error)}`);
    }
    return meta;
  }

  async #fetchPage(url: string) {
    const response = await this.#fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(this.#timeoutMs),
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('html')) throw new Error('not an HTML page');
    const html = decodeHtml(await readHtmlBytes(response), contentType);
    const base = response.url || url;
    return { head: parseHead(html, base), icons: iconLinks(html, base) };
  }

  async #download(
    page: string,
    label: 'image' | 'icon',
    candidates: string[],
  ): Promise<MediaRef | null> {
    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        return await this.#media.ensure(candidate, { kind: 'image' });
      } catch (error) {
        failures.push(`${redact(candidate)}: ${reason(error)}`);
      }
    }
    if (failures.length > 0)
      this.#warn(`Bookmark ${label} unavailable for ${page}: ${failures.join('; ')}`);
    return null;
  }

  async #read(file: string): Promise<CachedBookmark | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as CachedBookmark;
    } catch {
      return null;
    }
  }

  async #write(file: string, value: CachedBookmark): Promise<void> {
    await mkdir(this.#cacheDir, { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, file);
  }
}
