import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import { describe, expect, it } from 'vitest';
import { isNotFoundError, type NotionApi } from '../../src/notion/api';
import { createFixtureApi, createRecordingApi } from '../../src/notion/fixture-api';
import { normalizeId } from '../../src/notion/ids';
import { createFixtureSanitizer, scrub } from '../../src/notion/sanitize';
import type { DatabaseDisplay, NotionSiteConfig } from '../../src/notion/types';
import {
  block,
  database,
  dataSource,
  nextId,
  page,
  prop,
  rt,
  tableView,
} from '../helpers/notion-factory';
import { tempDir } from '../helpers/temp-dir';

const POSTS = 'a'.repeat(32);
const PROJECTS = 'b'.repeat(32);
const PROFILE = 'c'.repeat(32);
const ANONYMOUS = { object: 'user', id: '00000000-0000-0000-0000-000000000000' };
const IDS = { postsDatabaseId: POSTS, projectsDatabaseId: PROJECTS, profileDatabaseId: PROFILE };
const BLOCK = '1'.repeat(32);
const DS = '2'.repeat(32);
const LINKED = '3'.repeat(32);
const POSTS_DS = 'd'.repeat(32);
const PAGE = '6'.repeat(32);

describe('scrub', () => {
  it('removes signatures, users, emails, people and request ids', () => {
    const input = {
      request_id: 'r-1',
      created_by: { object: 'user', id: 'real-user', name: 'Real Name' },
      cover: {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png?X-Amz-Signature=abc',
          expiry_time: 'x',
        },
      },
      external: 'https://images.unsplash.com/photo?ixlib=rb-4',
      properties: {
        Email: { id: 'e', type: 'email', email: 'sup@lil.horse' },
        Owner: {
          id: 'o',
          type: 'people',
          people: [{ object: 'user', id: 'u', name: 'Real Name' }],
        },
      },
      rich_text: [
        {
          type: 'mention',
          mention: { type: 'user', user: { object: 'user', id: 'u', name: 'Real Name' } },
          plain_text: '@Real Name',
        },
      ],
    };
    expect(scrub(input)).toEqual({
      created_by: { object: 'user', id: '00000000-0000-0000-0000-000000000000' },
      cover: {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png',
          expiry_time: 'x',
        },
      },
      external: 'https://images.unsplash.com/photo?ixlib=rb-4',
      properties: {
        Email: { id: 'e', type: 'email', email: 'hello@example.com' },
        Owner: { id: 'o', type: 'people', people: [] },
      },
      rich_text: [
        {
          type: 'mention',
          mention: {
            type: 'user',
            user: { object: 'user', id: '00000000-0000-0000-0000-000000000000' },
          },
          plain_text: '@someone',
        },
      ],
    });
  });

  it('anonymizes users anywhere and drops phone numbers, but leaves empty user fields', () => {
    const schema = {
      Phone: { id: 'ph', name: 'Phone', type: 'phone_number', phone_number: {} },
      Creator: { id: 'cb', name: 'Creator', type: 'created_by', created_by: {} },
    };
    const input = {
      created_by: null,
      last_edited_by: {},
      properties: {
        Phone: { id: 'ph', type: 'phone_number', phone_number: '+1 555 0100' },
        Verification: {
          id: 'v',
          type: 'verification',
          verification: {
            state: 'verified',
            verified_by: {
              object: 'user',
              id: 'u',
              name: 'Real Name',
              type: 'person',
              person: { email: 'real@lil.horse' },
            },
            date: null,
          },
        },
      },
      schema,
    };
    expect(scrub(input)).toEqual({
      created_by: null,
      last_edited_by: {},
      properties: {
        Phone: { id: 'ph', type: 'phone_number', phone_number: null },
        Verification: {
          id: 'v',
          type: 'verification',
          verification: { state: 'verified', verified_by: ANONYMOUS, date: null },
        },
      },
      schema,
    });
  });

  it('replaces the workspace ID in Notion file URLs, but keeps the file ID and name', () => {
    const workspace = '7f3d2c1b-4a5e-4f60-8b9c-0d1e2f3a4b5c';
    const file = 'c4b3a291-8076-4e5d-9c3b-2a1f0e9d8c7b';
    const zero = '00000000-0000-0000-0000-000000000000';
    const input = {
      cover: {
        type: 'file',
        file: {
          url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/${workspace}/${file}/My%20photo.jpg?X-Amz-Signature=abc`,
          expiry_time: 'x',
        },
      },
      links: [
        `https://file.notion.so/f/f/${workspace}/${file}/notes.pdf?spaceId=${workspace}&signature=abc`,
        `https://img.notionusercontent.com/s3/prod-files-secure%2F${workspace}%2F${file}%2Fa.png/size/w=2000?exp=1&sig=abc`,
      ],
    };
    expect(scrub(input)).toEqual({
      cover: {
        type: 'file',
        file: {
          url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/${zero}/${file}/My%20photo.jpg`,
          expiry_time: 'x',
        },
      },
      links: [
        `https://file.notion.so/f/f/${zero}/${file}/notes.pdf`,
        `https://img.notionusercontent.com/s3/prod-files-secure%2F${zero}%2F${file}%2Fa.png/size/w=2000`,
      ],
    });
  });

  it('drops the public Notion URL of pages, databases and data sources, but not a column of that name', () => {
    const column = { id: 'p', type: 'url', url: 'https://example.com' };
    for (const object of ['page', 'database', 'data_source']) {
      const input = {
        object,
        id: 'x',
        url: 'https://www.notion.so/x',
        public_url: 'https://lil.notion.site/Secret-title-x',
        properties: { public_url: column },
      };
      expect(scrub(input)).toStrictEqual({
        object,
        id: 'x',
        url: 'https://www.notion.so/x',
        properties: { public_url: column },
      });
    }
  });
});

describe('createFixtureSanitizer', () => {
  it('keeps only published posts and visible projects, and writes other tables as placeholders', () => {
    const sanitize = createFixtureSanitizer(
      { postsDatabaseId: POSTS, projectsDatabaseId: PROJECTS, profileDatabaseId: PROFILE },
      2,
    );
    sanitize('retrieveDatabase', POSTS, database(POSTS, 'd'.repeat(32)));
    sanitize('retrieveDatabase', PROJECTS, database(PROJECTS, 'e'.repeat(32)));

    const posts = [
      page({ Name: prop.title('A'), Status: prop.status('Published') }),
      page({ Name: prop.title('B'), Status: prop.status('Draft') }),
    ];
    expect(
      (sanitize('queryDataSource', 'd'.repeat(32), posts) as { id: string }[]).map((row) => row.id),
    ).toEqual([posts[0]?.id]);

    const projects = [
      page({ Name: prop.title('P1'), Visible: prop.checkbox(true), Status: prop.select('Active') }),
      page({ Name: prop.title('P2'), Visible: prop.checkbox(false) }),
    ];
    expect(
      (sanitize('queryDataSource', 'e'.repeat(32), projects) as { id: string }[]).map(
        (row) => row.id,
      ),
    ).toEqual([projects[0]?.id]);

    const inline = [
      page({ Name: prop.title('1') }),
      page({ Name: prop.title('2') }),
      page({ Name: prop.title('3') }),
    ];
    expect(sanitize('queryDataSource', 'f'.repeat(32), inline)).toEqual([]);
    expect(
      sanitize(
        'queryViewPageIds',
        'view',
        inline.map((row) => row.id),
      ),
    ).toEqual([]);
  });

  it('records views with only the fields the site reads', () => {
    const sanitize = createFixtureSanitizer(IDS);
    const views = [
      {
        object: 'view',
        id: 'view-1',
        parent: { type: 'database_id', database_id: BLOCK },
        name: 'Reading list',
        type: 'table',
        url: 'https://www.notion.so/Reading-list-view1',
        data_source_id: DS,
        filter: { property: 'Note', rich_text: { contains: 'secret' } },
        quick_filters: { Note: { rich_text: { contains: 'secret' } } },
        sorts: [{ property: 'Note', direction: 'ascending' }],
        configuration: {
          type: 'table',
          properties: [
            { property_id: 'title', property_name: 'Name', visible: true, width: 280 },
            { property_id: 'note', property_name: 'Note', visible: false, wrap: true },
          ],
          group_by: {
            type: 'text',
            property_id: 'note',
            property_name: 'Note',
            group_by: 'exact',
            sort: { type: 'ascending' },
          },
        },
      },
      {
        object: 'view',
        id: 'view-2',
        name: 'Schedule',
        type: 'timeline',
        data_source_id: DS,
        configuration: {
          type: 'timeline',
          date_property_id: 'due',
          date_property_name: 'Note due',
          properties: [{ property_id: 'note', property_name: 'Note' }],
          table_properties: [{ property_id: 'note', property_name: 'Note' }],
        },
      },
      {
        object: 'view',
        id: 'view-3',
        name: 'Ratings',
        type: 'chart',
        data_source_id: DS,
        configuration: {
          type: 'chart',
          chart_type: 'bar',
          x_axis: {
            type: 'text',
            property_id: 'note',
            property_name: 'Note',
            group_by: 'exact',
            sort: { type: 'manual' },
          },
        },
      },
    ];
    const recorded = sanitize('listViews', BLOCK, views);
    expect(recorded).toEqual([
      {
        object: 'view',
        id: 'view-1',
        type: 'table',
        data_source_id: DS,
        configuration: {
          type: 'table',
          properties: [
            { property_id: 'title', visible: true },
            { property_id: 'note', visible: false },
          ],
        },
      },
      {
        object: 'view',
        id: 'view-2',
        type: 'timeline',
        data_source_id: DS,
        configuration: { type: 'timeline', properties: [{ property_id: 'note' }] },
      },
      {
        object: 'view',
        id: 'view-3',
        type: 'chart',
        data_source_id: DS,
        configuration: { type: 'chart' },
      },
    ]);
    expect(JSON.stringify(recorded)).not.toMatch(/Note|secret|Reading|Schedule|Ratings/);
  });

  it('records other databases with only the data source the site reads', () => {
    const sanitize = createFixtureSanitizer(IDS);
    const posts = database(POSTS, POSTS_DS);
    expect(sanitize('retrieveDatabase', POSTS, posts)).toEqual(posts);
    const inline = {
      ...database(BLOCK, DS, 'Private plans'),
      description: [rt('Secret notes')],
      url: `https://www.notion.so/Private-plans-${BLOCK}`,
      data_sources: [
        { id: DS, name: 'Private plans' },
        { id: '5'.repeat(32), name: 'Archive' },
      ],
    };
    expect(sanitize('retrieveDatabase', BLOCK, inline)).toEqual({
      object: 'database',
      id: BLOCK,
      title: [],
      data_sources: [{ id: DS }],
    });
  });
});

interface FakeData {
  databases?: Record<string, DatabaseObjectResponse>;
  dataSources?: Record<string, DataSourceObjectResponse>;
  rows?: Record<string, PageObjectResponse[]>;
  views?: Record<string, DataSourceViewObjectResponse[]>;
  orders?: Record<string, string[]>;
  pages?: Record<string, PageObjectResponse>;
  children?: Record<string, BlockObjectResponse[]>;
}

function fakeApi(data: FakeData): NotionApi {
  const find = async <T>(table: Record<string, T> | undefined, id: string): Promise<T> => {
    const value = table?.[id];
    if (value === undefined)
      throw Object.assign(new Error(`${id} not found`), { code: 'object_not_found' });
    return value;
  };
  return {
    retrieveDatabase: (id) => find(data.databases, id),
    retrieveDataSource: (id) => find(data.dataSources, id),
    queryDataSource: (id) => find(data.rows, id),
    listViews: (id) => find(data.views, id),
    queryViewPageIds: (id) => find(data.orders, id),
    retrievePage: (id) => find(data.pages, id),
    listBlockChildren: (id) => find(data.children, id),
  } as NotionApi;
}

// The calls buildDatabaseNode makes for one inline table, in the same order.
async function renderInlineTable(
  api: NotionApi,
  blockId: string,
  display: Record<string, DatabaseDisplay> = {},
): Promise<void> {
  const database = await api.retrieveDatabase(blockId);
  const views = database.data_sources.length === 0 ? await api.listViews(blockId) : undefined;
  const sourceView = views?.find((view) => view.type === 'table') ?? views?.[0];
  const source = database.data_sources[0]?.id ?? sourceView?.data_source_id;
  if (!source) return;
  await Promise.all([
    api.retrieveDataSource(normalizeId(source)),
    api.queryDataSource(normalizeId(source)),
  ]);
  if (display[blockId]) return;
  const view = (views ?? (await api.listViews(blockId))).find((item) => item.type === 'table');
  if (view) await api.queryViewPageIds(view.id);
}

// The lists fetchBlockTree requests, including those under blocks the site then drops.
async function fetchTree(api: NotionApi, blockId: string): Promise<BlockObjectResponse[]> {
  const blocks = await api.listBlockChildren(blockId);
  await Promise.all(
    blocks.map(async (item) => {
      if (item.type === 'synced_block' && item.synced_block.synced_from)
        await fetchTree(api, item.synced_block.synced_from.block_id);
      else if (item.has_children && item.type !== 'child_page' && item.type !== 'child_database')
        await fetchTree(api, item.id);
    }),
  );
  return blocks;
}

// The calls syncNotion makes for a standalone page whose inline tables sit at its top level.
async function renderPage(api: NotionApi, pageId: string): Promise<void> {
  await api.retrievePage(pageId);
  for (const item of await fetchTree(api, pageId)) {
    if (item.type !== 'child_database') continue;
    await renderInlineTable(api, normalizeId(item.id)).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

const childDatabase = (id: string, title: string) => block('child_database', { title }, { id });
const paragraph = (text: string, hasChildren = false) =>
  block('paragraph', { rich_text: [rt(text)], color: 'default' }, { hasChildren });
const syncedFrom = (original: string) =>
  block(
    'synced_block',
    { synced_from: { type: 'block_id', block_id: original } },
    { hasChildren: true },
  );

async function record(
  data: FakeData,
  render: (api: NotionApi) => Promise<void>,
  config: Parameters<typeof createFixtureSanitizer>[0] = IDS,
  maxInlineRows?: number,
) {
  const dir = await tempDir('fixtures-');
  const sanitize = createFixtureSanitizer(config, maxInlineRows);
  const api = createRecordingApi(fakeApi(data), dir, sanitize);
  await render(api);
  return { dir, sanitize, api, replay: createFixtureApi(dir) };
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const files = await readdir(dir);
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(join(dir, file), 'utf8')])),
  );
}

const everything = async (dir: string) => Object.values(await snapshot(dir)).join('\n');

function movies() {
  const schema = dataSource(DS, {
    Name: { id: 'title', type: 'title' },
    Rating: { id: '%3BKhU', type: 'select' },
    Watched: { id: 'watched', type: 'date' },
    Note: { id: 'note', type: 'rich_text' },
  });
  const rows = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name) =>
    page({
      Name: prop.title(name),
      Rating: prop.select('5'),
      Watched: prop.date('2024-01-01'),
      Note: prop.text(`Note on ${name}`),
    }),
  );
  return { schema, rows };
}

function schemaOf(
  properties: Record<string, Record<string, unknown>>,
  fields: Record<string, unknown> = {},
): DataSourceObjectResponse {
  return {
    object: 'data_source',
    id: DS,
    title: [],
    ...fields,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, config]) => [
        name,
        { name, description: null, ...config },
      ]),
    ),
  } as unknown as DataSourceObjectResponse;
}

// One inline table whose table view shows these property IDs and lists every row.
function showing(
  schema: DataSourceObjectResponse,
  rows: PageObjectResponse[],
  propertyIds: string[],
): FakeData {
  const view = tableView(
    'view-1',
    propertyIds.map((id) => ({ property_id: id })),
  );
  return {
    databases: { [BLOCK]: database(BLOCK, DS) },
    dataSources: { [DS]: schema },
    rows: { [DS]: rows },
    views: { [BLOCK]: [{ ...view, data_source_id: DS }] },
    orders: { 'view-1': rows.map((row) => row.id) },
  };
}

const names = (record: Record<string, unknown>) => Object.keys(record);

describe('FixtureSanitizer.prune', () => {
  it('keeps only the rows and columns the first table view shows', async () => {
    const { schema, rows } = movies();
    const [alpha, , charlie] = rows;
    const view = {
      ...tableView('view-1', [
        { property_id: 'title' },
        { property_id: ';KhU' },
        { property_id: 'note', visible: false },
      ]),
      data_source_id: DS,
      filter: { property: 'Note', rich_text: { is_not_empty: true } },
    };
    const { dir, sanitize, replay } = await record(
      {
        databases: { [BLOCK]: database(BLOCK, DS) },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
        views: { [BLOCK]: [view] },
        orders: { 'view-1': [charlie.id, alpha.id] },
      },
      (api) => renderInlineTable(api, BLOCK),
    );
    await sanitize.prune(dir);

    const kept = await replay.queryDataSource(DS);
    expect(kept.map((row) => row.id)).toEqual([charlie.id, alpha.id]);
    expect(kept.map((row) => names(row.properties))).toEqual([
      ['Name', 'Rating'],
      ['Name', 'Rating'],
    ]);
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(['Name', 'Rating']);
    const [recordedView] = await replay.listViews(BLOCK);
    expect(recordedView).not.toHaveProperty('filter');
    expect(recordedView?.configuration).toEqual({
      type: 'table',
      properties: [{ property_id: 'title' }, { property_id: ';KhU' }],
    });
    expect(await replay.queryViewPageIds('view-1')).toEqual([charlie.id, alpha.id]);
    const recorded = await everything(dir);
    for (const hidden of ['Bravo', 'Delta', 'Note', 'Watched'])
      expect(recorded).not.toContain(hidden);
  });

  it('writes placeholders while recording, the pruned table at prune, and placeholders again on a late write', async () => {
    const { schema, rows } = movies();
    const [alpha] = rows;
    const data = showing(schema, rows, ['title']);
    data.orders = { 'view-1': [alpha.id] };
    const { dir, sanitize, api, replay } = await record(data, (api) =>
      renderInlineTable(api, BLOCK),
    );
    const placeholder = { object: 'data_source', id: DS, title: [], properties: {} };
    const table = async () => ({
      rows: await replay.queryDataSource(DS),
      schema: await replay.retrieveDataSource(DS),
      order: await replay.queryViewPageIds('view-1'),
    });

    expect(await table()).toEqual({ rows: [], schema: placeholder, order: [] });

    await sanitize.prune(dir);
    const pruned = await table();
    expect(pruned.rows.map((row) => [row.id, names(row.properties)])).toEqual([
      [alpha.id, ['Name']],
    ]);
    expect(names(pruned.schema.properties)).toEqual(['Name']);
    expect(pruned.order).toEqual([alpha.id]);

    await Promise.all([
      api.retrieveDataSource(DS),
      api.queryDataSource(DS),
      api.queryViewPageIds('view-1'),
    ]);
    expect(await table()).toEqual({ rows: [], schema: placeholder, order: [] });
  });

  it('picks view rows from the whole table, not just the rows kept while recording', async () => {
    const { schema, rows } = movies();
    const [, , charlie, delta] = rows;
    const { dir, sanitize, replay } = await record(
      {
        databases: { [BLOCK]: database(BLOCK, DS) },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
        views: {
          [BLOCK]: [{ ...tableView('view-1', [{ property_id: 'title' }]), data_source_id: DS }],
        },
        orders: { 'view-1': [delta.id, charlie.id] },
      },
      (api) => renderInlineTable(api, BLOCK),
      IDS,
      2,
    );
    await sanitize.prune(dir);

    expect((await replay.queryDataSource(DS)).map((row) => row.id)).toEqual([delta.id, charlie.id]);
    expect(await replay.queryViewPageIds('view-1')).toEqual([delta.id, charlie.id]);
  });

  it('keeps exactly the configured columns and the sort column when the site configures the table', async () => {
    const { schema, rows } = movies();
    const config: NotionSiteConfig = {
      ...IDS,
      pages: { about: 'e'.repeat(32), contact: 'f'.repeat(32) },
      mastheadPageId: '9'.repeat(32),
      databaseDisplay: {
        [BLOCK]: {
          columns: [{ property: 'Rating', format: 'stars' }],
          sort: { property: 'Watched', direction: 'descending' },
        },
      },
    };
    const { dir, sanitize, replay } = await record(
      {
        databases: { [BLOCK]: database(BLOCK, DS) },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
      },
      (api) => renderInlineTable(api, BLOCK, config.databaseDisplay),
      config,
    );
    await sanitize.prune(dir);

    const kept = await replay.queryDataSource(DS);
    expect(kept.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(kept.map((row) => names(row.properties))).toEqual(rows.map(() => ['Rating', 'Watched']));
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(['Rating', 'Watched']);
    expect(await everything(dir)).not.toMatch(/Alpha|Bravo|Charlie|Delta/);
  });

  it('keeps the title and the non-empty columns when no table view shows the table', async () => {
    const { schema } = movies();
    const rows = ['Alpha', 'Bravo'].map((name) =>
      page({
        Name: prop.title(name),
        Rating: prop.select(null),
        Watched: prop.date('2024-01-01'),
        Note: prop.text(''),
      }),
    );
    const board = {
      object: 'view',
      id: 'board-1',
      type: 'board',
      data_source_id: DS,
      configuration: {
        type: 'board',
        properties: [{ property_id: ';KhU' }, { property_id: 'note' }],
      },
    } as unknown as DataSourceViewObjectResponse;
    const { dir, sanitize, replay } = await record(
      {
        databases: { [BLOCK]: database(BLOCK, DS) },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
        views: { [BLOCK]: [board] },
      },
      (api) => renderInlineTable(api, BLOCK),
    );
    await sanitize.prune(dir);

    expect((await replay.queryDataSource(DS)).map((row) => names(row.properties))).toEqual([
      ['Name', 'Watched'],
      ['Name', 'Watched'],
    ]);
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(['Name', 'Watched']);
  });

  it('follows a linked view to the data source its table view points at', async () => {
    const { schema, rows } = movies();
    const [, bravo] = rows;
    const view = {
      ...tableView('linked-view', [
        { property_id: 'title' },
        { property_id: 'note', visible: false },
      ]),
      data_source_id: '22222222-2222-2222-2222-222222222222',
    };
    const { dir, sanitize, replay } = await record(
      {
        databases: { [LINKED]: { ...database(LINKED, DS, 'Untitled'), data_sources: [] } },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
        views: { [LINKED]: [view] },
        orders: { 'linked-view': [bravo.id] },
      },
      (api) => renderInlineTable(api, LINKED),
    );
    await sanitize.prune(dir);

    const kept = await replay.queryDataSource(DS);
    expect(kept.map((row) => row.id)).toEqual([bravo.id]);
    expect(kept.map((row) => names(row.properties))).toEqual([['Name']]);
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(['Name']);
    expect((await replay.listViews(LINKED))[0]?.configuration).toEqual({
      type: 'table',
      properties: [{ property_id: 'title' }],
    });
  });

  it('reads a multi-source database from its first data source only', async () => {
    const FIRST = '5'.repeat(32);
    const { schema, rows } = movies();
    const [, bravo] = rows;
    const first = dataSource(FIRST, { Title: { id: 'title', type: 'title' } });
    const firstRows = [page({ Title: prop.title('First source') })];
    const { dir, sanitize, replay } = await record(
      {
        databases: {
          [BLOCK]: {
            ...database(BLOCK, FIRST),
            data_sources: [
              { id: FIRST, name: 'First' },
              { id: DS, name: 'Second' },
            ],
          },
          [LINKED]: { ...database(LINKED, DS, 'Untitled'), data_sources: [] },
        },
        dataSources: { [FIRST]: first, [DS]: schema },
        rows: { [FIRST]: firstRows, [DS]: rows },
        views: {
          [BLOCK]: [],
          [LINKED]: [
            {
              ...tableView('linked-view', [{ property_id: 'title' }, { property_id: ';KhU' }]),
              data_source_id: DS,
            },
          ],
        },
        orders: { 'linked-view': [bravo.id] },
      },
      async (api) => {
        await renderInlineTable(api, BLOCK);
        await renderInlineTable(api, LINKED);
      },
    );
    await sanitize.prune(dir);

    expect(
      (await replay.queryDataSource(DS)).map((row) => [row.id, names(row.properties)]),
    ).toEqual([[bravo.id, ['Name', 'Rating']]]);
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(['Name', 'Rating']);
    expect((await replay.queryDataSource(FIRST)).map((row) => row.id)).toEqual([firstRows[0]?.id]);
    expect(await everything(dir)).not.toMatch(/Alpha|Charlie|Delta|Note|Watched/);
  });

  it('keeps, per row, the columns of every block that shows that row', async () => {
    const { schema, rows } = movies();
    const [alpha, bravo, charlie, delta] = rows;
    const SECOND = '4'.repeat(32);
    const linked = (blockId: string) => ({
      ...database(blockId, DS, 'Untitled'),
      data_sources: [],
    });
    const views = (viewId: string, columns: string[]) => [
      {
        ...tableView(
          viewId,
          columns.map((id) => ({ property_id: id })),
        ),
        data_source_id: DS,
      },
    ];
    const { dir, sanitize, replay } = await record(
      {
        databases: {
          [BLOCK]: database(BLOCK, DS),
          [LINKED]: linked(LINKED),
          [SECOND]: linked(SECOND),
        },
        dataSources: { [DS]: schema },
        rows: { [DS]: rows },
        views: {
          [BLOCK]: [],
          [LINKED]: views('linked-view', ['title', ';KhU']),
          [SECOND]: views('second-view', ['title', 'note']),
        },
        orders: { 'linked-view': [charlie.id, delta.id], 'second-view': [delta.id, alpha.id] },
      },
      async (api) => {
        for (const blockId of [BLOCK, LINKED, SECOND]) await renderInlineTable(api, blockId);
      },
      IDS,
      2,
    );
    await sanitize.prune(dir);

    const all = ['Name', 'Rating', 'Watched', 'Note'];
    const kept = await replay.queryDataSource(DS);
    expect(kept.map((row) => [row.id, names(row.properties)])).toEqual([
      [alpha.id, all],
      [bravo.id, all],
      [charlie.id, ['Name', 'Rating']],
      [delta.id, ['Name', 'Rating', 'Note']],
    ]);
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual(all);
  });

  it('keeps only the row fields the site reads, with a Notion URL that carries no title', async () => {
    const { schema, rows } = movies();
    const [alpha] = rows;
    const decorated = rows.map((row) => ({
      ...row,
      url: `https://www.notion.so/Secret-title-${row.id}`,
      public_url: 'https://lil.notion.site/Secret-title',
      icon: { type: 'external', external: { url: 'https://example.com/secret-icon.png' } },
      cover: { type: 'external', external: { url: 'https://example.com/secret-cover.png' } },
    })) as PageObjectResponse[];
    const data = showing(schema, decorated, [';KhU']);
    data.orders = { 'view-1': [alpha.id] };
    const { dir, sanitize, replay } = await record(data, (api) => renderInlineTable(api, BLOCK));
    await sanitize.prune(dir);

    expect(await replay.queryDataSource(DS)).toEqual([
      {
        object: 'page',
        id: alpha.id,
        url: `https://www.notion.so/${normalizeId(alpha.id)}`,
        properties: { Rating: alpha.properties.Rating },
      },
    ]);
    expect(await everything(dir)).not.toMatch(/secret|alpha/i);
  });

  it('commits no values for formula, rollup, relation and other columns the site leaves empty', async () => {
    const schema = schemaOf({
      Name: { id: 'title', type: 'title', title: {} },
      Score: { id: 'score', type: 'formula', formula: { expression: 'prop("Secret") * 2' } },
      Total: {
        id: 'total',
        type: 'rollup',
        rollup: {
          relation_property_name: 'Links',
          rollup_property_name: 'Secret',
          function: 'show_original',
        },
      },
      Links: {
        id: 'links',
        type: 'relation',
        relation: {
          data_source_id: 'private-source',
          database_id: 'private-database',
          type: 'dual_property',
          dual_property: { synced_property_id: 'back', synced_property_name: 'Backlink' },
        },
      },
      Code: { id: 'code', type: 'unique_id', unique_id: { prefix: 'SECRET' } },
      Ask: { id: 'ask', type: 'button', button: {} },
      Files: { id: 'files', type: 'files', files: {} },
    });
    const row = page({
      Name: prop.title('Kept'),
      Score: { type: 'formula', formula: { type: 'string', string: 'secret output' } },
      Total: {
        type: 'rollup',
        rollup: { type: 'array', array: [prop.text('secret rollup')], function: 'show_original' },
      },
      Links: { type: 'relation', relation: [{ id: 'private-page' }], has_more: false },
      Code: { type: 'unique_id', unique_id: { prefix: 'SECRET', number: 7 } },
      Ask: { type: 'button', button: {} },
      Files: prop.files(['https://example.com/cover.png', 'https://example.com/secret-plan.pdf']),
    });
    const { dir, sanitize, replay } = await record(
      showing(schema, [row], ['title', 'score', 'total', 'links', 'code', 'ask', 'files']),
      (api) => renderInlineTable(api, BLOCK),
    );
    await sanitize.prune(dir);

    const [kept] = await replay.queryDataSource(DS);
    expect(kept?.properties).toEqual({
      Name: row.properties.Name,
      Files: {
        id: 'p6',
        type: 'files',
        files: [
          {
            type: 'external',
            name: 'cover.png',
            external: { url: 'https://example.com/cover.png' },
          },
        ],
      },
    });
    expect((await replay.retrieveDataSource(DS)).properties).toEqual({
      Name: { id: 'title', name: 'Name', type: 'title' },
      Score: { id: 'score', name: 'Score', type: 'formula' },
      Total: { id: 'total', name: 'Total', type: 'rollup' },
      Links: { id: 'links', name: 'Links', type: 'relation' },
      Code: { id: 'code', name: 'Code', type: 'unique_id' },
      Ask: { id: 'ask', name: 'Ask', type: 'button' },
      Files: { id: 'files', name: 'Files', type: 'files' },
    });
    expect(await everything(dir)).not.toMatch(/secret|private|backlink/i);
  });

  it('keeps only the options the kept rows use, and no descriptions', async () => {
    const option = (name: string, color: string) => ({
      id: `option-${name}`,
      name,
      color,
      description: `About ${name}`,
    });
    const schema = schemaOf(
      {
        Name: { id: 'title', type: 'title', title: {}, description: 'Book title' },
        Rating: {
          id: 'rating',
          type: 'select',
          select: { options: [option('5', 'green'), option('Hidden', 'red')] },
        },
        Tags: {
          id: 'tags',
          type: 'multi_select',
          multi_select: { options: [option('fiction', 'blue'), option('Unused', 'gray')] },
        },
        State: {
          id: 'state',
          type: 'status',
          status: {
            options: [option('Done', 'green'), option('Abandoned', 'red')],
            groups: [
              {
                id: 'group',
                name: 'Complete',
                color: 'green',
                option_ids: ['option-Done', 'option-Abandoned'],
              },
            ],
          },
        },
      },
      { title: [rt('Reading list')], description: [rt('Private notes')] },
    );
    const [dune, unread] = [
      page({
        Name: prop.title('Dune'),
        Rating: prop.select('5'),
        Tags: prop.multiSelect(['fiction']),
        State: prop.status('Done'),
      }),
      page({
        Name: prop.title('Unread'),
        Rating: prop.select('Hidden'),
        Tags: prop.multiSelect(['Unused']),
        State: prop.status('Abandoned'),
      }),
    ];
    const data = showing(schema, [dune, unread], ['title', 'rating', 'tags', 'state']);
    data.orders = { 'view-1': [dune.id] };
    const { dir, sanitize, replay } = await record(data, (api) => renderInlineTable(api, BLOCK));
    await sanitize.prune(dir);

    expect(await replay.retrieveDataSource(DS)).toEqual({
      object: 'data_source',
      id: DS,
      title: [],
      properties: {
        Name: { id: 'title', name: 'Name', type: 'title' },
        Rating: {
          id: 'rating',
          name: 'Rating',
          type: 'select',
          select: { options: [{ name: '5', color: 'green' }] },
        },
        Tags: {
          id: 'tags',
          name: 'Tags',
          type: 'multi_select',
          multi_select: { options: [{ name: 'fiction', color: 'blue' }] },
        },
        State: {
          id: 'state',
          name: 'State',
          type: 'status',
          status: { options: [{ name: 'Done', color: 'green' }] },
        },
      },
    });
    expect(await everything(dir)).not.toMatch(
      /Unread|Hidden|Unused|Abandoned|About|Private|Book title|Complete|Reading list/,
    );
  });

  it.each(['', 'Untitled'])(
    'commits a data source title only when a block titled %j shows it',
    async (untitled) => {
      const IDEAS = '5'.repeat(32);
      const PICKS = '4'.repeat(32);
      const titled = (dataSourceId: string, column: string, title: string) => ({
        ...dataSource(dataSourceId, { [column]: { id: 'title', type: 'title' } }),
        title: [rt(title)],
      });
      const linked = (blockId: string) => ({
        ...database(blockId, DS, 'Untitled'),
        data_sources: [],
      });
      const titleView = (viewId: string, dataSourceId: string) => [
        { ...tableView(viewId, [{ property_id: 'title' }]), data_source_id: dataSourceId },
      ];
      const [idea, item] = [
        page({ Idea: prop.title('Fly') }),
        page({ Item: prop.title('Old map') }),
      ];
      const { dir, sanitize, replay } = await record(
        {
          pages: { [PAGE]: page({ title: prop.title('Home') }, { id: PAGE }) },
          children: {
            [PAGE]: [
              childDatabase(BLOCK, 'Ideas'),
              childDatabase(PICKS, 'Picks'),
              childDatabase(LINKED, untitled),
            ],
          },
          databases: {
            [BLOCK]: {
              ...database(BLOCK, IDEAS, 'Ideas'),
              data_sources: [
                { id: IDEAS, name: 'Ideas' },
                { id: DS, name: 'Private archive' },
              ],
            },
            [PICKS]: linked(PICKS),
            [LINKED]: linked(LINKED),
          },
          dataSources: {
            [IDEAS]: titled(IDEAS, 'Idea', 'Ideas'),
            [DS]: titled(DS, 'Item', 'Private archive'),
          },
          rows: { [IDEAS]: [idea], [DS]: [item] },
          views: {
            [BLOCK]: [],
            [PICKS]: titleView('picks-view', DS),
            [LINKED]: titleView('linked-view', IDEAS),
          },
          orders: { 'picks-view': [item.id], 'linked-view': [idea.id] },
        },
        (api) => renderPage(api, PAGE),
      );
      await sanitize.prune(dir);

      expect((await replay.retrieveDataSource(IDEAS)).title).toEqual([{ plain_text: 'Ideas' }]);
      expect((await replay.retrieveDataSource(DS)).title).toEqual([]);
      expect(await everything(dir)).not.toContain('Private archive');
    },
  );

  it('blanks the titles of inline tables the site skips, in the list that names them', async () => {
    const { schema, rows } = movies();
    const [UNSHARED, SOURCELESS, PRIVATE] = ['4', '5', '7'].map((digit) => digit.repeat(32));
    const data = showing(schema, rows, ['title']);
    const { dir, sanitize, replay } = await record(
      {
        ...data,
        pages: { [PAGE]: page({ title: prop.title('Home') }, { id: PAGE }) },
        children: {
          [PAGE]: [
            childDatabase(BLOCK, 'Reading list'),
            childDatabase(UNSHARED, 'Secret unshared'),
            childDatabase(SOURCELESS, 'Secret sourceless'),
            childDatabase(PRIVATE, 'Secret source'),
          ],
        },
        databases: {
          ...data.databases,
          [SOURCELESS]: { ...database(SOURCELESS, DS, 'Untitled'), data_sources: [] },
          [PRIVATE]: database(PRIVATE, '8'.repeat(32)),
        },
        views: { ...data.views, [SOURCELESS]: [] },
      },
      (api) => renderPage(api, PAGE),
    );
    const titles = async () =>
      (await replay.listBlockChildren(PAGE)).map((item) =>
        item.type === 'child_database' ? item.child_database.title : item.type,
      );

    expect(await titles()).toEqual(['', '', '', '']);
    await sanitize.prune(dir);
    expect(await titles()).toEqual(['Reading list', '', '', '']);
    expect(await everything(dir)).not.toMatch(/secret/i);
  });

  it('leaves the main data sources untouched, even where a linked view hides part of one', async () => {
    const posts = dataSource(POSTS_DS, {
      Name: { id: 'title', type: 'title' },
      Status: { id: 'status', type: 'status' },
      Slug: { id: 'slug', type: 'rich_text' },
    });
    const [first, second, draft] = ['First', 'Second', 'Draft'].map((name) =>
      page({
        Name: prop.title(name),
        Status: prop.status(name === 'Draft' ? 'Draft' : 'Published'),
        Slug: prop.text(name.toLowerCase()),
      }),
    );
    const view = {
      ...tableView('posts-view', [
        { property_id: 'title' },
        { property_id: 'slug', visible: false },
      ]),
      data_source_id: POSTS_DS,
    };
    const { dir, sanitize } = await record(
      {
        databases: {
          [POSTS]: database(POSTS, POSTS_DS),
          [LINKED]: { ...database(LINKED, POSTS_DS, 'Untitled'), data_sources: [] },
        },
        dataSources: { [POSTS_DS]: posts },
        rows: { [POSTS_DS]: [first, second, draft] },
        views: { [LINKED]: [view] },
        orders: { 'posts-view': [second.id] },
      },
      async (api) => {
        const [source] = (await api.retrieveDatabase(POSTS)).data_sources;
        await api.queryDataSource(normalizeId(source.id));
        await renderInlineTable(api, LINKED);
      },
      IDS,
      1,
    );
    const before = await snapshot(dir);
    await sanitize.prune(dir);

    expect(await snapshot(dir)).toEqual(before);
  });
});

describe('recorded block children', () => {
  it('records no children under blocks whose children the site never renders', async () => {
    const toggle = block(
      'toggle',
      { rich_text: [rt('More')], color: 'default' },
      { hasChildren: true },
    );
    const notes = block('meeting_notes', { title: [rt('Weekly sync')] }, { hasChildren: true });
    const template = block('template', { rich_text: [rt('Add entry')] }, { hasChildren: true });
    const summary = paragraph('Secret summary', true);
    const [original, hiddenOriginal] = [nextId(), nextId()];
    const { dir, sanitize, replay } = await record(
      {
        pages: { [PAGE]: page({ title: prop.title('Home') }, { id: PAGE }) },
        children: {
          [PAGE]: [toggle, notes, template, syncedFrom(original)],
          [toggle.id]: [paragraph('Shown detail')],
          [notes.id]: [summary],
          [summary.id]: [paragraph('Secret transcript')],
          [template.id]: [syncedFrom(hiddenOriginal)],
          [original]: [paragraph('Shown synced')],
          [hiddenOriginal]: [paragraph('Secret synced')],
        },
      },
      (api) => renderPage(api, PAGE),
    );
    await sanitize.prune(dir);

    const listed = async (id: string) => JSON.stringify(await replay.listBlockChildren(id));
    expect((await replay.listBlockChildren(PAGE)).map((item) => item.type)).toEqual([
      'toggle',
      'meeting_notes',
      'template',
      'synced_block',
    ]);
    expect(await listed(toggle.id)).toContain('Shown detail');
    expect(await listed(original)).toContain('Shown synced');
    for (const id of [notes.id, summary.id, template.id, hiddenOriginal])
      expect(await replay.listBlockChildren(id)).toEqual([]);
    expect(await everything(dir)).not.toMatch(/secret/i);
  });

  it('keeps the bodies of published posts and retrieved pages, and of no other page', async () => {
    const [published, draft] = ['Published', 'Draft'].map((status) =>
      page({ Name: prop.title(status), Status: prop.status(status) }),
    );
    const { dir, replay } = await record(
      {
        databases: { [POSTS]: database(POSTS, POSTS_DS) },
        rows: { [POSTS_DS]: [published, draft] },
        pages: { [PAGE]: page({ title: prop.title('Home') }, { id: PAGE }) },
        children: {
          [published.id]: [paragraph('Post body')],
          [PAGE]: [paragraph('Page body')],
          [draft.id]: [paragraph('Secret draft body')],
          [BLOCK]: [paragraph('Secret block body')],
        },
      },
      async (api) => {
        const [source] = (await api.retrieveDatabase(POSTS)).data_sources;
        await api.queryDataSource(normalizeId(source.id));
        await renderPage(api, PAGE);
        for (const id of [published.id, draft.id, BLOCK]) await fetchTree(api, id);
      },
    );

    expect(JSON.stringify(await replay.listBlockChildren(published.id))).toContain('Post body');
    expect(JSON.stringify(await replay.listBlockChildren(PAGE))).toContain('Page body');
    expect(await replay.listBlockChildren(draft.id)).toEqual([]);
    expect(await replay.listBlockChildren(BLOCK)).toEqual([]);
    expect(await everything(dir)).not.toMatch(/secret/i);
  });
});
