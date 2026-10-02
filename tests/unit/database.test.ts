import type { ChildDatabaseBlockObjectResponse, PageObjectResponse } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';
import { buildDatabaseNode, type DatabaseDeps } from '../../src/notion/database';
import type { MediaStore } from '../../src/notion/media';
import type { DatabaseDisplay, MediaRef } from '../../src/notion/types';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, database, dataSource, page, prop, rt, tableView } from '../helpers/notion-factory';

const DB = '1'.repeat(32);
const DS = '2'.repeat(32);
const LINKED = '3'.repeat(32);

function movies() {
  const api = new FakeNotionApi();
  api.databases.set(DB, database(DB, DS, 'Watched Movies'));
  api.dataSources.set(DS, {
    ...dataSource(DS, {
      '电影/电视剧/番组': { id: 'title', type: 'title' },
      个人评分: { id: '%3BKhU', type: 'multi_select' },
      打分日期: { id: 'rated', type: 'date' },
      导演: { id: 'dir', type: 'rich_text' },
      备注: { id: 'note', type: 'rich_text' },
    }),
    title: [rt('Watched Movies')],
  });
  const strays = page({
    '电影/电视剧/番组': prop.title('复仇狗联盟 / Strays'),
    个人评分: prop.multiSelect(['5']),
    打分日期: prop.date('2023-11-15'),
    导演: prop.text('Josh Greenbaum'),
    备注: prop.text(''),
  });
  const schindler = page({
    '电影/电视剧/番组': prop.title("辛德勒的名单 / Schindler's List"),
    个人评分: prop.multiSelect(['5']),
    打分日期: prop.date('2023-10-21'),
    导演: prop.text(''),
    备注: prop.text(''),
  });
  const bear = page({
    '电影/电视剧/番组': prop.title('熊家餐馆 第二季 / The Bear S2'),
    个人评分: prop.multiSelect(['4']),
    打分日期: prop.date('2023-07-30'),
    导演: prop.text(''),
    备注: prop.text(''),
  });
  api.rows.set(DS, [bear, strays, schindler]);
  return { api, strays, schindler, bear };
}

function table(schema: Record<string, { id: string; type: string }>, rows: PageObjectResponse[]) {
  const api = new FakeNotionApi();
  api.databases.set(DB, database(DB, DS));
  api.dataSources.set(DS, dataSource(DS, schema));
  api.rows.set(DS, rows);
  return api;
}

function linkTo(api: FakeNotionApi, dataSourceId: string | null) {
  api.databases.set(LINKED, { ...database(LINKED, DS, 'Untitled'), data_sources: [] });
  api.views.set(LINKED, [
    {
      ...tableView('linked-view', [{ property_id: 'title' }, { property_id: ';KhU' }]),
      data_source_id: dataSourceId,
    },
  ]);
}

const storedImage = (url: string): MediaRef => ({
  key: url,
  kind: 'image',
  mime: 'image/png',
  bytes: 2048,
  fileName: 'image.png',
  src: url,
  width: 600,
  height: 900,
  variants: [],
  dominant: null,
});

function deps(api: FakeNotionApi, display: Record<string, DatabaseDisplay> = {}) {
  const warnings: string[] = [];
  const sources: string[] = [];
  const ensured: Parameters<MediaStore['ensure']>[] = [];
  const media = {
    ensure: async (...args: Parameters<MediaStore['ensure']>) => {
      ensured.push(args);
      return storedImage(args[0]);
    },
  } as MediaStore;
  const value: DatabaseDeps = {
    api,
    media,
    display,
    warn: (message) => warnings.push(message),
    onDataSource: (id) => sources.push(id),
  };
  return { value, warnings, sources, ensured };
}

const childDatabase = (id = DB, title = 'Watched Movies') =>
  block('child_database', { title }, { id }) as ChildDatabaseBlockObjectResponse;

const notFound = () =>
  Object.assign(new Error('Could not find view'), { code: 'object_not_found' });

describe('buildDatabaseNode', () => {
  it('follows the site configuration first, including star ratings and sorting', async () => {
    const { api } = movies();
    const { value, sources } = deps(api, {
      [DB]: {
        columns: [
          { property: '电影/电视剧/番组' },
          { property: '个人评分', format: 'stars' },
          { property: '打分日期' },
        ],
        sort: { property: '打分日期', direction: 'descending' },
      },
    });
    const node = await buildDatabaseNode(childDatabase(), value);
    expect(node?.columns.map((column) => [column.name, column.format])).toEqual([
      ['电影/电视剧/番组', null],
      ['个人评分', 'stars'],
      ['打分日期', null],
    ]);
    expect(node?.rows.map((row) => row.cells.rated)).toEqual([
      { kind: 'date', start: '2023-11-15', end: null },
      { kind: 'date', start: '2023-10-21', end: null },
      { kind: 'date', start: '2023-07-30', end: null },
    ]);
    expect(node?.rows[2]?.cells['%3BKhU']).toEqual({ kind: 'stars', value: 4 });
    expect(sources).toEqual([DS]);
    expect(api.calls.some((call) => call.startsWith('listViews'))).toBe(false);
  });

  it('uses the first table view when there is no configuration', async () => {
    const { api, schindler, strays } = movies();
    api.views.set(DB, [
      tableView('view-1', [
        { property_id: 'title' },
        { property_id: ';KhU' },
        { property_id: 'dir', visible: false },
      ]),
    ]);
    api.viewOrders.set('view-1', [schindler.id, strays.id]);
    const node = await buildDatabaseNode(childDatabase(), deps(api).value);
    expect(node?.columns.map((column) => column.name)).toEqual(['电影/电视剧/番组', '个人评分']);
    expect(node?.rows.map((row) => row.id)).toEqual([schindler.id, strays.id]);
    expect(node?.rows[0]?.cells['%3BKhU']).toEqual({
      kind: 'chips',
      values: [{ name: '5', color: 'blue' }],
    });
    const order = api.calls.map((call) => call.split(':')[0]);
    expect(order.indexOf('queryDataSource')).toBeLessThan(order.indexOf('queryViewPageIds'));
  });

  it('falls back to the title and non-empty columns', async () => {
    const { api } = movies();
    const node = await buildDatabaseNode(childDatabase(), deps(api).value);
    expect(node?.columns.map((column) => column.name)).toEqual([
      '电影/电视剧/番组',
      '个人评分',
      '导演',
      '打分日期',
    ]);
  });

  it('skips databases the integration cannot read, without failing', async () => {
    const api = new FakeNotionApi();
    const { value, warnings, sources } = deps(api);
    await expect(buildDatabaseNode(childDatabase('9'.repeat(32)), value)).resolves.toBeNull();
    expect(warnings[0]).toContain('not shared with the integration');
    expect(sources).toEqual([]);
  });

  it('reads a linked view through the data source its table view points at', async () => {
    const { api, schindler, strays } = movies();
    linkTo(api, '22222222-2222-2222-2222-222222222222');
    api.viewOrders.set('linked-view', [schindler.id, strays.id]);
    const { value, sources } = deps(api);
    const node = await buildDatabaseNode(childDatabase(LINKED, 'Untitled'), value);
    expect(node?.title).toBe('Watched Movies');
    expect(node?.columns.map((column) => column.name)).toEqual(['电影/电视剧/番组', '个人评分']);
    expect(node?.rows.map((row) => row.id)).toEqual([schindler.id, strays.id]);
    expect(sources).toEqual([DS]);
    expect(api.calls.map((call) => call.split(':')[0])).toEqual([
      'retrieveDatabase',
      'listViews',
      'retrieveDataSource',
      'queryDataSource',
      'queryViewPageIds',
    ]);
  });

  it('applies the site configuration keyed by the linked view block', async () => {
    const { api, strays, schindler, bear } = movies();
    linkTo(api, DS);
    const { value } = deps(api, {
      [LINKED]: {
        columns: [{ property: '电影/电视剧/番组' }],
        sort: { property: '打分日期', direction: 'descending' },
      },
    });
    const node = await buildDatabaseNode(childDatabase(LINKED, 'Untitled'), value);
    expect(node?.rows.map((row) => row.id)).toEqual([strays.id, schindler.id, bear.id]);
    expect(api.calls.map((call) => call.split(':')[0])).toEqual([
      'retrieveDatabase',
      'listViews',
      'retrieveDataSource',
      'queryDataSource',
    ]);
  });

  it('skips a linked view whose source is missing or not shared', async () => {
    const { api } = movies();
    const { value, warnings, sources } = deps(api);
    linkTo(api, '4'.repeat(32));
    await expect(buildDatabaseNode(childDatabase(LINKED, 'Untitled'), value)).resolves.toBeNull();
    linkTo(api, null);
    await expect(buildDatabaseNode(childDatabase(LINKED, 'Untitled'), value)).resolves.toBeNull();
    expect(warnings).toEqual([
      expect.stringContaining('not shared with the integration'),
      expect.stringContaining('has no data source'),
    ]);
    expect(sources).toEqual([]);
  });

  it('skips a linked view whose views the integration cannot read', async () => {
    const { api } = movies();
    linkTo(api, DS);
    vi.spyOn(api, 'listViews').mockRejectedValue(notFound());
    const { value, warnings, sources } = deps(api);
    await expect(buildDatabaseNode(childDatabase(LINKED, 'Untitled'), value)).resolves.toBeNull();
    expect(warnings).toEqual([
      expect.stringContaining('views or source database are not shared with the integration'),
    ]);
    expect(sources).toEqual([]);
  });

  it('falls back to the default columns when the views cannot be read', async () => {
    const { api, bear, strays, schindler } = movies();
    vi.spyOn(api, 'listViews').mockRejectedValue(notFound());
    const { value, warnings, sources } = deps(api);
    const node = await buildDatabaseNode(childDatabase(), value);
    expect(node?.columns.map((column) => column.name)).toEqual([
      '电影/电视剧/番组',
      '个人评分',
      '导演',
      '打分日期',
    ]);
    expect(node?.rows.map((row) => row.id)).toEqual([bear.id, strays.id, schindler.id]);
    expect(warnings).toEqual([expect.stringContaining('views could not be read')]);
    expect(sources).toEqual([DS]);
  });

  it('fails on views errors other than not found', async () => {
    const { api } = movies();
    const outage = Object.assign(new Error('Service unavailable'), { code: 'service_unavailable' });
    vi.spyOn(api, 'listViews').mockRejectedValue(outage);
    await expect(buildDatabaseNode(childDatabase(), deps(api).value)).rejects.toBe(outage);
    linkTo(api, DS);
    await expect(
      buildDatabaseNode(childDatabase(LINKED, 'Untitled'), deps(api).value),
    ).rejects.toBe(outage);
  });

  it('counts files as content only when they hold an image', async () => {
    const api = table(
      {
        名称: { id: 'title', type: 'title' },
        海报: { id: 'poster', type: 'files' },
        附件: { id: 'docs', type: 'files' },
      },
      [
        page({
          名称: prop.title('Strays'),
          海报: prop.files(['https://example.com/poster.png']),
          附件: prop.files(['https://example.com/notes.pdf']),
        }),
      ],
    );
    const node = await buildDatabaseNode(childDatabase(), deps(api).value);
    expect(node?.columns.map((column) => column.name)).toEqual(['名称', '海报']);
  });

  it('picks default columns from the rows the view shows', async () => {
    const { api, schindler, bear } = movies();
    api.views.set(DB, [tableView('view-1', [])]);
    api.viewOrders.set('view-1', [schindler.id, bear.id]);
    const node = await buildDatabaseNode(childDatabase(), deps(api).value);
    expect(node?.columns.map((column) => column.name)).toEqual([
      '电影/电视剧/番组',
      '个人评分',
      '打分日期',
    ]);
  });

  it('orders default columns by code point', async () => {
    const api = table(
      {
        名称: { id: 'title', type: 'title' },
        '🎬 片单': { id: 'film', type: 'rich_text' },
        '（备注）': { id: 'note', type: 'rich_text' },
      },
      [
        page({
          名称: prop.title('Strays'),
          '🎬 片单': prop.text('yes'),
          '（备注）': prop.text('yes'),
        }),
      ],
    );
    const node = await buildDatabaseNode(childDatabase(), deps(api).value);
    expect(node?.columns.map((column) => column.name)).toEqual(['名称', '（备注）', '🎬 片单']);
  });

  it('sorts text with the Chinese collation on any machine', async () => {
    const titles = ['熊家餐馆', 'apple', '复仇狗联盟', '辛德勒的名单'];
    const rows = titles.map((title) => page({ 名称: prop.title(title) }));
    const api = table({ 名称: { id: 'title', type: 'title' } }, rows);
    const { value } = deps(api, {
      [DB]: { columns: [{ property: '名称' }], sort: { property: '名称', direction: 'ascending' } },
    });
    const node = await buildDatabaseNode(childDatabase(), value);
    const titleOf = new Map(rows.map((row, index) => [row.id, titles[index]]));
    expect(node?.rows.map((row) => titleOf.get(row.id))).toEqual([
      '复仇狗联盟',
      '辛德勒的名单',
      '熊家餐馆',
      'apple',
    ]);
  });

  it('warns about a sort property the schema lacks and keeps the query order', async () => {
    const { api, bear, strays, schindler } = movies();
    const { value, warnings } = deps(api, {
      [DB]: {
        columns: [{ property: '电影/电视剧/番组' }],
        sort: { property: '评分日期', direction: 'descending' },
      },
    });
    const node = await buildDatabaseNode(childDatabase(), value);
    expect(node?.rows.map((row) => row.id)).toEqual([bear.id, strays.id, schindler.id]);
    expect(warnings).toEqual([expect.stringContaining('sort property "评分日期" does not exist')]);
  });

  it('turns image files into media cells through the media store', async () => {
    const api = table(
      { 名称: { id: 'title', type: 'title' }, 海报: { id: 'poster', type: 'files' } },
      [
        page({
          名称: prop.title('Strays'),
          海报: prop.files(['https://example.com/poster.png', 'https://example.com/notes.pdf']),
        }),
      ],
    );
    const { value, ensured } = deps(api);
    const node = await buildDatabaseNode(childDatabase(), value);
    expect(ensured).toEqual([
      ['https://example.com/poster.png', { kind: 'image', fileNameHint: 'poster.png' }],
    ]);
    expect(node?.rows[0]?.cells.poster).toEqual({
      kind: 'media',
      items: [storedImage('https://example.com/poster.png')],
    });
  });

  it('shows an empty star rating as an empty cell', async () => {
    const api = table(
      { 名称: { id: 'title', type: 'title' }, 个人评分: { id: 'rating', type: 'multi_select' } },
      [page({ 名称: prop.title('Strays'), 个人评分: prop.multiSelect([]) })],
    );
    const { value } = deps(api, { [DB]: { columns: [{ property: '个人评分', format: 'stars' }] } });
    const node = await buildDatabaseNode(childDatabase(), value);
    expect(node?.rows[0]?.cells.rating).toEqual({ kind: 'empty' });
  });

  it('titles a table with a blank block title after its data source', async () => {
    const { api } = movies();
    const node = await buildDatabaseNode(childDatabase(DB, ''), deps(api).value);
    expect(node?.title).toBe('Watched Movies');
  });

  it('sorts rows without a value last in both directions', async () => {
    const undated = page({ 名称: prop.title('Undated'), 打分日期: prop.date(null) });
    const early = page({ 名称: prop.title('Early'), 打分日期: prop.date('2023-07-30') });
    const late = page({ 名称: prop.title('Late'), 打分日期: prop.date('2023-11-15') });
    const api = table(
      { 名称: { id: 'title', type: 'title' }, 打分日期: { id: 'rated', type: 'date' } },
      [undated, early, late],
    );
    const order = async (direction: 'ascending' | 'descending') => {
      const { value } = deps(api, {
        [DB]: { columns: [{ property: '名称' }], sort: { property: '打分日期', direction } },
      });
      const node = await buildDatabaseNode(childDatabase(), value);
      return node?.rows.map((row) => row.id);
    };
    expect(await order('ascending')).toEqual([early.id, late.id, undated.id]);
    expect(await order('descending')).toEqual([late.id, early.id, undated.id]);
  });
});
