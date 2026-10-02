import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageContent } from './types';

export interface PageCacheRecord {
  version: number;
  digest: string;
  childDataSourceIds: string[];
  content: PageContent;
}

export class PageCache {
  readonly #dir: string;
  readonly #version: number;

  constructor(dir: string, version: number) {
    this.#dir = dir;
    this.#version = version;
  }

  async read(pageId: string): Promise<PageCacheRecord | null> {
    try {
      const record = JSON.parse(
        await readFile(join(this.#dir, `${pageId}.json`), 'utf8'),
      ) as Partial<PageCacheRecord>;
      const valid =
        record.version === this.#version &&
        typeof record.digest === 'string' &&
        Array.isArray(record.childDataSourceIds) &&
        typeof record.content === 'object' &&
        record.content !== null;
      return valid ? (record as PageCacheRecord) : null;
    } catch {
      return null;
    }
  }

  async write(pageId: string, record: PageCacheRecord): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = join(this.#dir, `${pageId}.json`);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, file);
  }
}
