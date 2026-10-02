import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PageCache } from '../../src/notion/page-cache';
import type { PageContent } from '../../src/notion/types';

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
    const dir = await mkdtemp(join(tmpdir(), 'pages-'));
    const cache = new PageCache(dir, 1);
    await cache.write('page', { version: 1, digest: 'abc', childDataSourceIds: [], content });
    expect(await cache.read('page')).toMatchObject({ digest: 'abc' });
    expect(await new PageCache(dir, 2).read('page')).toBeNull();
    await writeFile(join(dir, 'broken.json'), '{"version":1,"dig');
    expect(await cache.read('broken')).toBeNull();
    expect(await cache.read('missing')).toBeNull();
  });
});
