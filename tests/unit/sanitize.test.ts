import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import { describe, expect, it } from 'vitest';
import type { NotionApi } from '../../src/notion/api';
import { createFixtureApi, createRecordingApi } from '../../src/notion/fixture-api';
import { normalizeId } from '../../src/notion/ids';
import { createFixtureSanitizer, scrub } from '../../src/notion/sanitize';
import type { DatabaseDisplay, NotionSiteConfig } from '../../src/notion/types';
import { database, dataSource, page, prop, tableView } from '../helpers/notion-factory';

const POSTS = 'a'.repeat(32);
const PROJECTS = 'b'.repeat(32);
const PROFILE = 'c'.repeat(32);
const ANONYMOUS = { object: 'user', id: '00000000-0000-0000-0000-000000000000' };

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
});

describe('createFixtureSanitizer', () => {
  it('keeps only published posts, visible projects, and truncates inline databases', () => {
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
    const kept = sanitize('queryDataSource', 'f'.repeat(32), inline) as { id: string }[];
    expect(kept).toHaveLength(2);
    const keptIds = kept.map((row) => row.id);
    const allIds = inline.map((row) => row.id);
    expect(sanitize('queryViewPageIds', 'view', allIds)).toEqual(keptIds);
  });

  it('drops view filters as views are recorded', () => {
    const sanitize = createFixtureSanitizer({
      postsDatabaseId: POSTS,
      projectsDatabaseId: PROJECTS,
      profileDatabaseId: PROFILE,
    });
    const view = tableView('view', [{ property_id: 'title' }]);
    const filtered = {
      ...view,
      filter: { property: 'Owner', people: { contains: 'real-user' } },
      quick_filters: { Owner: { people: { contains: 'real-user' } } },
    };
    expect(sanitize('listViews', 'f'.repeat(32), [filtered])).toEqual([view]);
  });
});

const IDS = { postsDatabaseId: POSTS, projectsDatabaseId: PROJECTS, profileDatabaseId: PROFILE };
const BLOCK = '1'.repeat(32);
const DS = '2'.repeat(32);
const LINKED = '3'.repeat(32);
const POSTS_DS = 'd'.repeat(32);

interface FakeData {
  databases?: Record<string, DatabaseObjectResponse>;
  dataSources?: Record<string, DataSourceObjectResponse>;
  rows?: Record<string, PageObjectResponse[]>;
  views?: Record<string, DataSourceViewObjectResponse[]>;
  orders?: Record<string, string[]>;
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
  if (!source) throw new Error(`${blockId} has no data source`);
  await Promise.all([
    api.retrieveDataSource(normalizeId(source)),
    api.queryDataSource(normalizeId(source)),
  ]);
  if (display[blockId]) return;
  const view = (views ?? (await api.listViews(blockId))).find((item) => item.type === 'table');
  if (view) await api.queryViewPageIds(view.id);
}

async function record(
  data: FakeData,
  render: (api: NotionApi) => Promise<void>,
  config: Parameters<typeof createFixtureSanitizer>[0] = IDS,
  maxInlineRows?: number,
) {
  const dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
  const sanitize = createFixtureSanitizer(config, maxInlineRows);
  await render(createRecordingApi(fakeApi(data), dir, sanitize));
  return { dir, sanitize, replay: createFixtureApi(dir) };
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const files = await readdir(dir);
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(join(dir, file), 'utf8')])),
  );
}

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
    const everything = Object.values(await snapshot(dir)).join('\n');
    for (const hidden of ['Bravo', 'Delta', 'Note', 'Watched'])
      expect(everything).not.toContain(hidden);
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

  it('keeps the configured columns, the sort column and the title when the site configures the table', async () => {
    const { schema, rows } = movies();
    const config: NotionSiteConfig = {
      ...IDS,
      pages: { about: 'e'.repeat(32), contact: 'f'.repeat(32) },
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
    expect(kept.map((row) => names(row.properties))).toEqual(
      rows.map(() => ['Name', 'Rating', 'Watched']),
    );
    expect(names((await replay.retrieveDataSource(DS)).properties)).toEqual([
      'Name',
      'Rating',
      'Watched',
    ]);
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
