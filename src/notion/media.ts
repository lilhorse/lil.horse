import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import type { MediaRef, MediaVariant } from './types';

export const MEDIA_WIDTHS = [480, 960, 1440] as const;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

// Bump whenever the same download would produce different files or a different MediaRef.
const CACHE_VERSION = 1;
const NOTION_FILE_HOST =
  /^(prod-files-secure\.s3([.-][a-z0-9-]+)?\.amazonaws\.com|secure\.notion-static\.com|file\.notion\.so|img\.notionusercontent\.com)$/;
const S3_PATH_STYLE_HOST = /^s3([.-][a-z0-9-]+)?\.amazonaws\.com$/;
const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff', 'heif']);
// sharp cannot decode ICO, so icons are kept as they are.
const ICON_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon']);
const RESERVED_NAME = /^(meta\.json|\d+\.(avif|webp))$/i;
// ext4 allows 255 bytes per file name, and a CJK character takes 3.
const MAX_NAME_BYTES = 200;
const USER_AGENT = 'lil.horse-build/1.0 (+https://lil.horse)';
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
};

interface CacheEntry {
  version: number;
  ref: MediaRef;
}

export class MediaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaTooLargeError';
  }
}

export class MediaDownloadError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = 'MediaDownloadError';
    this.status = options?.status;
  }
}

function isNotionFile({ hostname, pathname }: URL): boolean {
  return (
    NOTION_FILE_HOST.test(hostname) ||
    (S3_PATH_STYLE_HOST.test(hostname) && pathname.startsWith('/secure.notion-static.com/'))
  );
}

export function mediaCacheKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  if (isNotionFile(parsed)) parsed.search = '';
  return createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 16);
}

function redact(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Notion's image proxy carries the source URL, percent-encoded, in its path.
function urlFileName(url: string): string {
  return basename(safeDecodeURIComponent(new URL(url).pathname).split(/[?#]/)[0] ?? '');
}

function lastBytes(text: string, limit: number): string {
  const chars = [...text].slice(-limit);
  while (Buffer.byteLength(chars.join('')) > limit) chars.shift();
  return chars.join('');
}

function safeFileName(hint: string, mime: string): string {
  const cleaned = safeDecodeURIComponent(hint)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '-');
  let name = lastBytes(cleaned, MAX_NAME_BYTES).replace(/^[-.]+|-+$/g, '') || 'file';
  if (!extname(name)) name += EXTENSIONS[mime] ?? '';
  return RESERVED_NAME.test(name) ? `file-${name}` : name;
}

function isRetryable(error: unknown): boolean {
  const status = error instanceof MediaDownloadError ? error.status : undefined;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MediaStoreOptions {
  cacheDir: string;
  publicPrefix?: string;
  fetch?: typeof fetch;
  maxBytes?: number;
  retries?: number;
  retryDelayMs?: number;
}

export class MediaStore {
  readonly #dir: string;
  readonly #prefix: string;
  readonly #fetch: typeof fetch;
  readonly #maxBytes: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;
  readonly #pending = new Map<string, Promise<MediaRef>>();

  constructor(options: MediaStoreOptions) {
    this.#dir = options.cacheDir;
    this.#prefix = options.publicPrefix ?? '/_media';
    this.#fetch = options.fetch ?? fetch;
    this.#maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES;
    this.#retries = options.retries ?? 3;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
  }

  has(key: string): boolean {
    return this.#cached(key) !== null;
  }

  directoryFor(key: string): string {
    return join(this.#dir, key);
  }

  ensure(
    url: string,
    options: { kind: 'image' | 'file'; fileNameHint?: string },
  ): Promise<MediaRef> {
    const key = mediaCacheKey(url);
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const task = this.#ensure(key, url, options).finally(() => this.#pending.delete(key));
    this.#pending.set(key, task);
    return task;
  }

  #cached(key: string): MediaRef | null {
    try {
      const entry = JSON.parse(
        readFileSync(join(this.directoryFor(key), 'meta.json'), 'utf8'),
      ) as Partial<CacheEntry>;
      return entry.version === CACHE_VERSION ? (entry.ref ?? null) : null;
    } catch {
      return null;
    }
  }

  async #ensure(
    key: string,
    url: string,
    options: { kind: 'image' | 'file'; fileNameHint?: string },
  ): Promise<MediaRef> {
    const cached = this.#cached(key);
    if (cached) return cached;
    const { bytes, mime } = await this.#download(url);
    const fileName = safeFileName(options.fileNameHint ?? urlFileName(url), mime);
    // Built aside and renamed into place, so an entry is never partial or mixed with older files.
    const staging = `${this.directoryFor(key)}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(staging, { recursive: true });
    try {
      await writeFile(join(staging, fileName), bytes);
      const ref = await this.#describe(key, staging, fileName, bytes, mime, options.kind).catch(
        (cause: unknown) => {
          throw new MediaDownloadError(`Cannot read image ${redact(url)}`, { cause });
        },
      );
      const entry: CacheEntry = { version: CACHE_VERSION, ref };
      await writeFile(join(staging, 'meta.json'), JSON.stringify(entry));
      return await this.#install(key, staging, ref);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  // Only renames touch the entry directory, so concurrent writers never see one half-deleted.
  async #install(key: string, staging: string, ref: MediaRef): Promise<MediaRef> {
    const dir = this.directoryFor(key);
    const outdated = `${staging}.old`;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(staging, dir);
        return ref;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== 'ENOTEMPTY' && code !== 'EEXIST') || attempt === 5) throw error;
      }
      const current = this.#cached(key);
      if (current) return current;
      await rename(dir, outdated).catch(() => undefined);
      await rm(outdated, { recursive: true, force: true });
    }
  }

  async #download(url: string): Promise<{ bytes: Buffer; mime: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept: '*/*' },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new MediaDownloadError(`HTTP ${response.status}`, { status: response.status });
        }
        const bytes = await this.#readBody(response, url);
        const mime =
          (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ||
          'application/octet-stream';
        return { bytes, mime };
      } catch (error) {
        if (error instanceof MediaTooLargeError) throw error;
        lastError = error;
        if (!isRetryable(error)) break;
        if (attempt < this.#retries) await sleep(this.#retryDelayMs * 2 ** attempt);
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new MediaDownloadError(`Failed to download ${redact(url)}: ${reason}`, {
      cause: lastError,
      status: lastError instanceof MediaDownloadError ? lastError.status : undefined,
    });
  }

  async #readBody(response: Response, url: string): Promise<Buffer> {
    const tooLarge = () => new MediaTooLargeError(`${redact(url)} exceeds ${this.#maxBytes} bytes`);
    if (Number(response.headers.get('content-length') ?? 0) > this.#maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.byteLength;
      if (total > this.#maxBytes) throw tooLarge();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }

  async #describe(
    key: string,
    dir: string,
    fileName: string,
    bytes: Buffer,
    mime: string,
    kind: 'image' | 'file',
  ): Promise<MediaRef> {
    const base: MediaRef = {
      key,
      kind,
      mime,
      bytes: bytes.length,
      fileName,
      src: `${this.#prefix}/${key}/${fileName}`,
      width: null,
      height: null,
      variants: [],
      dominant: null,
    };
    if (kind !== 'image' || ICON_TYPES.has(mime)) return base;
    const meta = await sharp(bytes).metadata();
    const { width, height } = meta.autoOrient;
    const animated = meta.delay !== undefined;
    if (animated || !RASTER_FORMATS.has(meta.format)) return { ...base, width, height };

    const { dominant, isOpaque } = await sharp(bytes).stats();
    const targets: number[] = MEDIA_WIDTHS.filter((candidate) => candidate <= width);
    if (targets.length === 0) targets.push(width);
    const variants: MediaVariant[] = [];
    for (const target of targets) {
      for (const format of ['avif', 'webp'] as const) {
        const pipeline = sharp(bytes).rotate().resize({ width: target, withoutEnlargement: true });
        const encoded =
          format === 'avif'
            ? pipeline.avif({ quality: 55, effort: 4 })
            : pipeline.webp({ quality: 78 });
        await encoded.toFile(join(dir, `${target}.${format}`));
        variants.push({ width: target, format, src: `${this.#prefix}/${key}/${target}.${format}` });
      }
    }
    return {
      ...base,
      width,
      height,
      variants,
      dominant: isOpaque ? `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}` : null,
    };
  }
}
