import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaStore } from './media';
import type { BookmarkMeta, MediaRef } from './types';

const USER_AGENT = 'lil.horse-build/1.0 (+https://lil.horse)';
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = match[1]?.toLowerCase();
    if (name) result[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function absolute(value: string | undefined, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

export function parseHead(html: string, baseUrl: string) {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
  }
  let icon: string | undefined;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(attrs.rel ?? '') && attrs.href) {
      icon = attrs.href;
      break;
    }
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
    image: absolute(meta.get('og:image') || meta.get('twitter:image'), baseUrl),
    icon: absolute(icon, baseUrl),
  };
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
  readonly #options: Required<Omit<BookmarkFetcherOptions, 'warn'>> & {
    warn: (message: string) => void;
  };

  constructor(options: BookmarkFetcherOptions) {
    this.#options = {
      fetch,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      now: Date.now,
      timeoutMs: 5_000,
      warn: () => undefined,
      ...options,
    };
  }

  async get(url: string): Promise<BookmarkMeta | null> {
    const file = join(
      this.#options.cacheDir,
      `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`,
    );
    const cached = await this.#read(file);
    if (cached && this.#options.now() - cached.fetchedAt < this.#options.ttlMs) return cached.meta;
    try {
      const response = await this.#options.fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(this.#options.timeoutMs),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!(response.headers.get('content-type') ?? '').includes('html'))
        throw new Error('not an HTML page');
      const html = (await response.text()).slice(0, 512 * 1024);
      const head = parseHead(html, response.url || url);
      const meta: BookmarkMeta = {
        title: head.title,
        description: head.description,
        siteName: head.siteName,
        image: await this.#image(head.image),
        icon: await this.#image(head.icon),
      };
      await this.#write(file, { fetchedAt: this.#options.now(), meta });
      return meta;
    } catch (error) {
      this.#options.warn(
        `Bookmark metadata unavailable for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return cached?.meta ?? null;
    }
  }

  async #image(url: string | null): Promise<MediaRef | null> {
    if (!url) return null;
    try {
      return await this.#options.media.ensure(url, { kind: 'image' });
    } catch {
      return null;
    }
  }

  async #read(file: string): Promise<CachedBookmark | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as CachedBookmark;
    } catch {
      return null;
    }
  }

  async #write(file: string, value: CachedBookmark): Promise<void> {
    await mkdir(this.#options.cacheDir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, file);
  }
}
