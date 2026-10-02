import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BookmarkFetcher } from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { buildPageContent } from '../../src/notion/page-content';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, database, dataSource, nextId, page, prop, rt } from '../helpers/notion-factory';

describe('buildPageContent', () => {
  it('assembles blocks, headings, media and inline database sources for one page', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'content-'));
    const media = new MediaStore({ cacheDir: join(dir, 'media'), fetch: placeholderFetch });
    const bookmarks = new BookmarkFetcher({
      cacheDir: join(dir, 'bookmarks'),
      media,
      fetch: placeholderFetch,
    });
    const api = new FakeNotionApi();
    const pageId = nextId();
    const databaseId = nextId();
    const dataSourceId = nextId();
    api.databases.set(databaseId, database(databaseId, dataSourceId, 'Movies'));
    api.dataSources.set(
      dataSourceId,
      dataSource(dataSourceId, { Name: { id: 'title', type: 'title' } }),
    );
    api.rows.set(dataSourceId, [page({ Name: prop.title('Strays') })]);
    api.setChildren(pageId, [
      block('heading_1', { rich_text: [rt('Movies')], color: 'default', is_toggleable: false }),
      block('paragraph', { rich_text: [rt('A backup of my Douban data.')], color: 'default' }),
      block('image', {
        type: 'external',
        external: { url: 'https://img.example.com/cover.png' },
        caption: [rt('Cover')],
      }),
      block('child_database', { title: 'Movies' }, { id: databaseId }),
    ]);

    const content = await buildPageContent(pageId, {
      api,
      media,
      bookmarks,
      databaseDisplay: {},
      warn: () => undefined,
    });

    expect(content.blocks.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'database',
    ]);
    expect(content.headings).toEqual([{ anchor: 'movies', text: 'Movies', level: 2 }]);
    expect(content.firstParagraph).toBe('A backup of my Douban data.');
    expect(content.childDataSourceIds).toEqual([dataSourceId]);
    expect(content.mediaKeys).toHaveLength(1);
    expect(content.priorityImageId).toBe(content.blocks[2]?.id);
    expect(content.hasMath).toBe(false);
  });
});
