import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageContent } from './types';

export interface PageCacheRecord {
  version: number;
  digest: string;
  childDataSourceIds: string[];
  warnings: string[];
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
        await readFile(this.#file(pageId), 'utf8'),
      ) as Partial<PageCacheRecord>;
      const valid =
        record.version === this.#version &&
        typeof record.digest === 'string' &&
        Array.isArray(record.childDataSourceIds) &&
        Array.isArray(record.warnings) &&
        Array.isArray(record.content?.blocks) &&
        Array.isArray(record.content?.mediaKeys);
      return valid ? (record as PageCacheRecord) : null;
    } catch {
      return null;
    }
  }

  async write(pageId: string, record: PageCacheRecord): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const file = this.#file(pageId);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, file);
  }

  async delete(pageId: string): Promise<void> {
    await rm(this.#file(pageId), { force: true });
  }

  #file(pageId: string): string {
    return join(this.#dir, `${pageId}.json`);
  }
}
