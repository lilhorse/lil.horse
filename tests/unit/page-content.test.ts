import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BookmarkFetcher } from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { buildPageContent } from '../../src/notion/page-content';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, database, dataSource, nextId, page, prop, rt } from '../helpers/notion-factory';
import { tempDir } from '../helpers/temp-dir';

const noMedia = {
  media: {} as MediaStore,
  bookmarks: {} as BookmarkFetcher,
  databaseDisplay: {},
  warn: () => undefined,
};

describe('buildPageContent', () => {
  it('never gives a heading the id the layout uses for <main>', async () => {
    const api = new FakeNotionApi();
    const pageId = nextId();
    api.setChildren(pageId, [
      block('heading_1', { rich_text: [rt('Main')], color: 'default', is_toggleable: false }),
    ]);

    const content = await buildPageContent(pageId, { api, ...noMedia });

    expect(content.headings).toEqual([{ anchor: 'main-1', text: 'Main', level: 2 }]);
  });

  it('names the page it could not build and keeps the original error as the cause', async () => {
    const api = new FakeNotionApi();
    const failure = new Error('Notion is unavailable');
    vi.spyOn(api, 'listBlockChildren').mockRejectedValue(failure);
    const pageId = nextId();

    const error = await buildPageContent(pageId, { api, ...noMedia }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `Failed to build Notion page https://www.notion.so/${pageId}: Notion is unavailable`,
    );
    expect((error as Error).cause).toBe(failure);
  });

  it('names the page when the failure is not an Error', async () => {
    const api = new FakeNotionApi();
    vi.spyOn(api, 'listBlockChildren').mockRejectedValue('socket hang up');
    const pageId = nextId();

    await expect(buildPageContent(pageId, { api, ...noMedia })).rejects.toThrow(
      `Failed to build Notion page https://www.notion.so/${pageId}: socket hang up`,
    );
  });

  it('names the page by its canonical Notion URL', async () => {
    const api = new FakeNotionApi();
    vi.spyOn(api, 'listBlockChildren').mockRejectedValue(new Error('Notion is unavailable'));

    await expect(
      buildPageContent('71d7802a-0abf-4857-a535-dfd861d8491e', { api, ...noMedia }),
    ).rejects.toThrow(
      'Failed to build Notion page https://www.notion.so/71d7802a0abf4857a535dfd861d8491e: Notion is unavailable',
    );
  });

  it('rejects an invalid page id before calling Notion', async () => {
    const api = new FakeNotionApi();
    const listBlockChildren = vi.spyOn(api, 'listBlockChildren');

    await expect(buildPageContent('not-a-page', { api, ...noMedia })).rejects.toThrow(
      /^Invalid Notion ID: "not-a-page"$/,
    );
    expect(listBlockChildren).not.toHaveBeenCalled();
  });

  it('assembles blocks, headings, media and inline database sources for one page', async () => {
    const dir = await tempDir('content-');
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
