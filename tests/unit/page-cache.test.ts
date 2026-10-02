import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PageCache, type PageCacheRecord } from '../../src/notion/page-cache';
import type { PageContent } from '../../src/notion/types';
import { tempDir } from '../helpers/temp-dir';

const content: PageContent = {
  blocks: [],
  headings: [],
  plainText: '',
  firstParagraph: null,
  hasMath: false,
  priorityImageId: null,
  childDataSourceIds: [],
  mediaKeys: [],
  linkedPageIds: [],
};

describe('PageCache', () => {
  it('round-trips records and rejects corrupt or outdated files', async () => {
    const dir = await tempDir('pages-');
    const cache = new PageCache(dir, 1);
    await cache.write('page', {
      version: 1,
      digest: 'abc',
      childDataSourceIds: [],
      warnings: [],
      content,
    });
    expect(await cache.read('page')).toMatchObject({ digest: 'abc' });
    expect(await new PageCache(dir, 2).read('page')).toBeNull();
    await writeFile(join(dir, 'broken.json'), '{"version":1,"dig');
    expect(await cache.read('broken')).toBeNull();
    expect(await cache.read('missing')).toBeNull();
  });

  it('keeps one whole record when the same page is written twice at once', async () => {
    const cache = new PageCache(await tempDir('pages-'), 1);
    await Promise.all(
      ['first', 'second'].map((digest) =>
        cache.write('page', { version: 1, digest, childDataSourceIds: [], warnings: [], content }),
      ),
    );
    expect(['first', 'second']).toContain((await cache.read('page'))?.digest);
  });

  it('deletes a record and ignores one that is already gone', async () => {
    const dir = join(await tempDir('pages-'), 'pages');
    const cache = new PageCache(dir, 1);
    await cache.delete('page');
    await cache.write('page', {
      version: 1,
      digest: 'abc',
      childDataSourceIds: [],
      warnings: [],
      content,
    });
    await cache.delete('page');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects a current-version record of another shape', async () => {
    const dir = await tempDir('pages-');
    const record: PageCacheRecord = {
      version: 1,
      digest: 'abc',
      childDataSourceIds: [],
      warnings: [],
      content,
    };
    const files = {
      current: record,
      'no-warnings': { ...record, warnings: undefined },
      'no-media-keys': { ...record, content: { ...content, mediaKeys: undefined } },
      'no-blocks': { ...record, content: { ...content, blocks: undefined } },
    };
    for (const [pageId, value] of Object.entries(files))
      await writeFile(join(dir, `${pageId}.json`), JSON.stringify(value));
    const cache = new PageCache(dir, 1);
    expect(await cache.read('current')).toEqual(record);
    expect(await cache.read('no-warnings')).toBeNull();
    expect(await cache.read('no-media-keys')).toBeNull();
    expect(await cache.read('no-blocks')).toBeNull();
  });
});
