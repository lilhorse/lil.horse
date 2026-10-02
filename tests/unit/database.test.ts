import type { ChildDatabaseBlockObjectResponse } from '@notionhq/client';
import { describe, expect, it } from 'vitest';
import { buildDatabaseNode, type DatabaseDeps } from '../../src/notion/database';
import type { MediaStore } from '../../src/notion/media';
import type { DatabaseDisplay } from '../../src/notion/types';
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

function linkTo(api: FakeNotionApi, dataSourceId: string | null) {
  api.databases.set(LINKED, { ...database(LINKED, DS, 'Untitled'), data_sources: [] });
  api.views.set(LINKED, [
    {
      ...tableView('linked-view', [{ property_id: 'title' }, { property_id: ';KhU' }]),
      data_source_id: dataSourceId,
    },
  ]);
}

function deps(api: FakeNotionApi, display: Record<string, DatabaseDisplay> = {}) {
  const warnings: string[] = [];
  const sources: string[] = [];
  const value: DatabaseDeps = {
    api,
    media: {} as MediaStore,
    display,
    warn: (message) => warnings.push(message),
    onDataSource: (id) => sources.push(id),
  };
  return { value, warnings, sources };
}

const childDatabase = (id = DB, title = 'Watched Movies') =>
  block('child_database', { title }, { id }) as ChildDatabaseBlockObjectResponse;

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
    const { value, warnings } = deps(api);
    await expect(buildDatabaseNode(childDatabase('9'.repeat(32)), value)).resolves.toBeNull();
    expect(warnings[0]).toContain('not shared with the integration');
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
});
