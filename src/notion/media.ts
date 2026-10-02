import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import type { MediaRef, MediaVariant } from './types';

export const MEDIA_WIDTHS = [480, 960, 1440] as const;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const NOTION_FILE_HOST =
  /(^|\.)(amazonaws\.com|notion-static\.com|notionusercontent\.com)$|^file\.notion\.so$/;
const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'tiff', 'heif']);
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

export class MediaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaTooLargeError';
  }
}

export class MediaDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MediaDownloadError';
  }
}

export function mediaCacheKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  if (NOTION_FILE_HOST.test(parsed.hostname)) parsed.search = '';
  return createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 16);
}

function redact(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
}

function safeFileName(hint: string, mime: string): string {
  let name: string;
  try {
    name = decodeURIComponent(hint);
  } catch {
    name = hint;
  }
  name =
    name
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-100) || 'file';
  if (!extname(name)) name += EXTENSIONS[mime] ?? '';
  return name;
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
    return existsSync(join(this.#dir, key, 'meta.json'));
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

  async #ensure(
    key: string,
    url: string,
    options: { kind: 'image' | 'file'; fileNameHint?: string },
  ): Promise<MediaRef> {
    const dir = join(this.#dir, key);
    const metaPath = join(dir, 'meta.json');
    if (existsSync(metaPath)) return JSON.parse(await readFile(metaPath, 'utf8')) as MediaRef;
    const { bytes, mime } = await this.#download(url);
    const fileName = safeFileName(options.fileNameHint ?? basename(new URL(url).pathname), mime);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), bytes);
    const ref = await this.#describe(key, dir, fileName, bytes, mime, options.kind);
    // meta.json is written last and atomically: its presence means the entry is complete.
    const temporary = `${metaPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(ref));
    await rename(temporary, metaPath);
    return ref;
  }

  async #download(url: string): Promise<{ bytes: Buffer; mime: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept: '*/*' },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok)
          throw new MediaDownloadError(`HTTP ${response.status} for ${redact(url)}`);
        if (Number(response.headers.get('content-length') ?? 0) > this.#maxBytes) {
          throw new MediaTooLargeError(`${redact(url)} exceeds ${this.#maxBytes} bytes`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > this.#maxBytes)
          throw new MediaTooLargeError(
            `${redact(url)} is ${bytes.length} bytes; the limit is ${this.#maxBytes}`,
          );
        const mime =
          (response.headers.get('content-type') ?? 'application/octet-stream')
            .split(';')[0]
            ?.trim() ?? 'application/octet-stream';
        return { bytes, mime };
      } catch (error) {
        if (error instanceof MediaTooLargeError) throw error;
        lastError = error;
        if (attempt < this.#retries) await sleep(this.#retryDelayMs * 2 ** attempt);
      }
    }
    throw new MediaDownloadError(`Failed to download ${redact(url)}`, { cause: lastError });
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
    if (kind !== 'image') return base;
    const meta = await sharp(bytes, { animated: true }).metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? null;
    const height = meta.autoOrient?.height ?? meta.pageHeight ?? meta.height ?? null;
    if (!meta.format || !RASTER_FORMATS.has(meta.format) || !width)
      return { ...base, width, height };

    const { dominant } = await sharp(bytes).stats();
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
      dominant: `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`,
    };
  }
}
