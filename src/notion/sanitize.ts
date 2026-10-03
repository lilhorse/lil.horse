import type {
  BlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import type { NotionApi } from './api';
import { writeFixture } from './fixture-api';
import { normalizeId, notionUrl, parseId } from './ids';
import type { DatabaseDisplay } from './types';

type Method = keyof NotionApi;
type Block = BlockObjectResponse;
type Database = DatabaseObjectResponse;
type Schema = DataSourceObjectResponse;
type Column = Schema['properties'][string];
type View = DataSourceViewObjectResponse;
type Row = PageObjectResponse;
type Value = Row['properties'][string];
type FileEntry = Extract<Value, { type: 'files' }>['files'][number];

export interface FixtureSanitizer {
  (method: Method, arg: string, value: unknown): unknown;
  /**
   * Writes the recorded inline tables and block lists, cut down to what the site renders.
   * Each table keeps only its first maxInlineRows rows (25 by default).
   */
  prune(dir: string): Promise<void>;
}

const NOTION_FILE_HOST =
  /(^|\.)(amazonaws\.com|notion-static\.com|notionusercontent\.com)$|^file\.notion\.so$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The workspace UUID sits right before the file UUID; the image proxy percent-encodes the slash.
const WORKSPACE_ID = new RegExp(`(?<=/|%2F)${UUID}(?=(?:/|%2F)${UUID}(?:/|%2F|$))`, 'gi');
const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const ANONYMOUS_USER = { object: 'user', id: ZERO_ID };

function scrubFileUrl(value: string): string {
  if (!/^https?:\/\//.test(value)) return value;
  try {
    const url = new URL(value);
    if (!NOTION_FILE_HOST.test(url.hostname)) return value;
    url.search = '';
    url.pathname = url.pathname.replace(WORKSPACE_ID, ZERO_ID);
    return url.toString();
  } catch {
    return value;
  }
}

const isFilled = (value: unknown) =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0;

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === 'string') return scrubFileUrl(value);
  if (value === null || typeof value !== 'object') return value;
  if ('object' in value && value.object === 'user') return ANONYMOUS_USER;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'request_id') continue;
    // `{}` here is a schema's column config, not a user.
    const isUser = (key === 'created_by' || key === 'last_edited_by') && isFilled(child);
    out[key] = isUser ? ANONYMOUS_USER : scrub(child);
  }
  if (out.object === 'page' || out.object === 'database' || out.object === 'data_source')
    delete out.public_url;
  if (out.type === 'people' && Array.isArray(out.people)) out.people = [];
  if (out.type === 'email' && typeof out.email === 'string') out.email = 'hello@example.com';
  if (out.type === 'phone_number' && typeof out.phone_number === 'string') out.phone_number = null;
  if (out.type === 'user' && typeof out.user === 'object' && out.user !== null)
    out.user = ANONYMOUS_USER;
  const mention = out.mention as { type?: string } | undefined;
  if (out.type === 'mention' && mention?.type === 'user') out.plain_text = '@someone';
  return out;
}

type Role = 'posts' | 'projects' | 'profile';

function isPublicRow(role: Role, row: Row): boolean {
  if (role === 'profile') return true;
  if (role === 'projects') {
    const visible = row.properties.Visible;
    return visible?.type === 'checkbox' && visible.checkbox;
  }
  const status = row.properties.Status;
  if (status?.type === 'status') return status.status?.name === 'Published';
  if (status?.type === 'select') return status.select?.name === 'Published';
  return false;
}

const idOf = (value: string): string => parseId(value) ?? value;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Keep in sync with the fields src/notion/database.ts reads.
const RENDERED_TYPES = new Set<string>([
  'title',
  'rich_text',
  'number',
  'select',
  'status',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'files',
  'created_time',
  'last_edited_time',
]);
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

// Keep in sync with the block types src/notion/ast.ts renders the children of.
const RENDERS_CHILDREN = new Set<string>([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'table',
  'column_list',
  'column',
  'synced_block',
  'tab',
]);

const untitled = (block: Block): Block =>
  block.type === 'child_database' ? { ...block, child_database: { title: '' } } : block;

// `title` must stay, even empty: the SDK's isFullDatabase and isFullDataSource check for it.
const databaseFields = (database: Database) =>
  ({
    object: database.object,
    id: database.id,
    title: [],
    data_sources: database.data_sources.slice(0, 1).map(({ id }) => ({ id })),
  }) as unknown as Database;

const placeholderSchema = (schema: Schema) => ({
  object: schema.object,
  id: schema.id,
  title: [],
  properties: {},
});

function viewFields(view: View): View {
  const { object, id, type, data_source_id, configuration } = view;
  const columns =
    configuration && 'properties' in configuration ? configuration.properties : undefined;
  return {
    object,
    id,
    type,
    data_source_id,
    ...(configuration && {
      configuration: {
        type: configuration.type,
        ...(columns && {
          properties: columns.map(({ property_id, visible }) => ({ property_id, visible })),
        }),
      },
    }),
  } as unknown as View;
}

function isImage(file: FileEntry): boolean {
  const url =
    file.type === 'external' ? file.external.url : file.type === 'file' ? file.file.url : '';
  return url !== '' && (IMAGE_FILE.test(file.name) || IMAGE_FILE.test(url));
}

function shownValue(value: Value | undefined): Value | undefined {
  if (!value || !RENDERED_TYPES.has(value.type)) return undefined;
  return value.type === 'files' ? { ...value, files: value.files.filter(isImage) } : value;
}

function hasContent(value: Value | undefined): boolean {
  const shown = shownValue(value);
  const data = shown && (shown as unknown as Record<string, unknown>)[shown.type];
  return Array.isArray(data) ? data.length > 0 : data !== undefined && data !== null && data !== '';
}

function defaultColumns(schema: Schema, rows: Row[]): Set<string> {
  const shown = Object.values(schema.properties).filter(
    (column) =>
      column.type === 'title' || rows.some((row) => hasContent(row.properties[column.name])),
  );
  return new Set(shown.map((column) => column.name));
}

function rowFields(row: Row, columns: Set<string>): Row {
  const properties = Object.entries(row.properties).flatMap(([name, value]) => {
    const shown = columns.has(name) ? shownValue(value) : undefined;
    return shown ? [[name, shown] as const] : [];
  });
  return {
    object: row.object,
    id: row.id,
    url: notionUrl(row.id),
    properties: Object.fromEntries(properties),
  } as Row;
}

function optionsOf(column: Column) {
  if (column.type === 'select') return column.select.options;
  if (column.type === 'multi_select') return column.multi_select.options;
  if (column.type === 'status') return column.status.options;
  return undefined;
}

function optionNames(value: Value | undefined): string[] {
  if (value?.type === 'select') return value.select ? [value.select.name] : [];
  if (value?.type === 'status') return value.status ? [value.status.name] : [];
  if (value?.type === 'multi_select') return value.multi_select.map((option) => option.name);
  return [];
}

function columnFields(column: Column, rows: Row[]) {
  const { id, name, type } = column;
  const options = optionsOf(column);
  if (!options) return { id, name, type };
  const used = new Set(rows.flatMap((row) => optionNames(row.properties[name])));
  const kept = options.filter((option) => used.has(option.name));
  return { id, name, type, [type]: { options: kept.map(({ name, color }) => ({ name, color })) } };
}

function schemaFields(schema: Schema, columns: Set<string>, rows: Row[], titleShown: boolean) {
  const properties = Object.entries(schema.properties)
    .filter(([, column]) => columns.has(column.name))
    .map(([key, column]) => [key, columnFields(column, rows)]);
  return {
    object: schema.object,
    id: schema.id,
    title: titleShown ? schema.title.map(({ plain_text }) => ({ plain_text })) : [],
    properties: Object.fromEntries(properties),
  };
}

function withColumns(view: View, keeps: (propertyId: string) => boolean): View {
  const configuration = view.configuration;
  if (!configuration || !('properties' in configuration) || !configuration.properties) return view;
  const properties = configuration.properties.filter((column) => keeps(column.property_id));
  return { ...view, configuration: { ...configuration, properties } };
}

// One ID can arrive in several spellings, and each spelling names its own fixture file.
interface Recorded<T> {
  args: Set<string>;
  value: T;
}

type Calls<T> = Map<string, Recorded<T>>;

function remember<T>(calls: Calls<T>, arg: string, value: T): void {
  const id = idOf(arg);
  calls.set(id, { args: (calls.get(id)?.args ?? new Set<string>()).add(arg), value });
}

interface Layout {
  columns: Set<string>;
  rows: Row[];
  order?: { call: Recorded<string[]>; pageIds: string[] };
}

export function createFixtureSanitizer(
  ids: {
    postsDatabaseId: string;
    projectsDatabaseId: string;
    profileDatabaseId: string;
    databaseDisplay?: Record<string, DatabaseDisplay>;
  },
  maxInlineRows = 25,
): FixtureSanitizer {
  const rolesByDatabase = new Map<string, Role>([
    [normalizeId(ids.postsDatabaseId), 'posts'],
    [normalizeId(ids.projectsDatabaseId), 'projects'],
    [normalizeId(ids.profileDatabaseId), 'profile'],
  ]);
  const rolesByDataSource = new Map<string, Role>();
  const keptRowIds = new Set<string>();
  const databases: Calls<Database> = new Map();
  const viewLists: Calls<View[]> = new Map();
  const schemas: Calls<Schema> = new Map();
  const inlineRows: Calls<Row[]> = new Map();
  const viewOrders: Calls<string[]> = new Map();
  const blockLists: Calls<Block[]> = new Map();
  const tableTitles = new Map<string, string>();
  const shownParents = new Set<string>();
  const recorded = new Set<string>();

  const sanitize = (method: Method, arg: string, value: unknown): unknown => {
    recorded.add(`${method}:${idOf(arg)}`);
    const clean = scrub(value);
    switch (method) {
      case 'retrieveDatabase': {
        const database = clean as Database;
        const role = rolesByDatabase.get(idOf(arg));
        if (role)
          for (const source of database.data_sources) rolesByDataSource.set(idOf(source.id), role);
        const kept = role ? database : databaseFields(database);
        remember(databases, arg, kept);
        return kept;
      }
      case 'listViews': {
        const views = (clean as View[]).map(viewFields);
        remember(viewLists, arg, views);
        return views;
      }
      // Other tables stay placeholders until prune, so a crash or a late write leaks nothing.
      case 'retrieveDataSource': {
        const schema = clean as Schema;
        if (rolesByDataSource.has(idOf(arg))) return schema;
        remember(schemas, arg, schema);
        return placeholderSchema(schema);
      }
      case 'queryDataSource': {
        const rows = clean as Row[];
        const role = rolesByDataSource.get(idOf(arg));
        if (!role) {
          remember(inlineRows, arg, rows);
          return [];
        }
        const kept = rows.filter((row) => isPublicRow(role, row));
        for (const row of kept) keptRowIds.add(idOf(row.id));
        return kept;
      }
      case 'queryViewPageIds': {
        const pageIds = clean as string[];
        remember(viewOrders, arg, pageIds);
        return pageIds.filter((id) => keptRowIds.has(idOf(id)));
      }
      case 'retrievePage':
        shownParents.add(idOf((clean as Row).id));
        return clean;
      case 'listBlockChildren': {
        // Every parent the site renders is registered before its children are requested.
        if (!keptRowIds.has(idOf(arg)) && !shownParents.has(idOf(arg))) return [];
        const blocks = clean as Block[];
        for (const block of blocks) {
          const original = block.type === 'synced_block' && block.synced_block.synced_from;
          if (original) shownParents.add(idOf(original.block_id));
          else if (RENDERS_CHILDREN.has(block.type)) shownParents.add(idOf(block.id));
          if (block.type === 'child_database')
            tableTitles.set(idOf(block.id), block.child_database.title);
        }
        remember(blockLists, arg, blocks);
        // Table titles stay blank until prune knows which tables render.
        return blocks.map(untitled);
      }
      default:
        return clean;
    }
  };

  // Keep in sync with how buildDatabaseNode finds a block's data source.
  const sourceOf = (blockId: string): string | undefined => {
    const views = viewLists.get(blockId)?.value ?? [];
    const sourceView = views.find((view) => view.type === 'table') ?? views[0];
    const reference =
      databases.get(blockId)?.value.data_sources[0]?.id ?? sourceView?.data_source_id;
    return reference ? idOf(reference) : undefined;
  };

  // Keep in sync with when buildDatabaseNode skips a table; a 404 never reaches the sanitizer.
  const rendersTable = (blockId: string): boolean => {
    const source = sourceOf(blockId);
    return (
      source !== undefined &&
      recorded.has(`retrieveDataSource:${source}`) &&
      recorded.has(`queryDataSource:${source}`)
    );
  };

  // Keep in sync with how buildDatabaseNode picks a table's title.
  const showsSourceTitle = (blockId: string): boolean => {
    const title = tableTitles.get(blockId);
    return title === '' || title === 'Untitled';
  };

  // Keep in sync with how buildDatabaseNode picks columns and rows.
  const layoutOf = (
    blockId: string,
    schema: Schema,
    rows: Row[],
    nameById: Map<string, string>,
  ): Layout => {
    const firstRows = rows.slice(0, maxInlineRows);
    const display = ids.databaseDisplay?.[blockId];
    if (display) {
      const names = display.columns.map((column) => column.property);
      // The site sorts rows by this column, even when it is not shown.
      if (display.sort) names.push(display.sort.property);
      return { columns: new Set(names), rows: firstRows };
    }
    const view = viewLists.get(blockId)?.value.find((item) => item.type === 'table');
    if (!view) return { columns: defaultColumns(schema, firstRows), rows: firstRows };
    const configured =
      view.configuration?.type === 'table' ? (view.configuration.properties ?? []) : [];
    const shown = configured
      .filter((column) => column.visible !== false)
      .flatMap((column) => nameById.get(decode(column.property_id)) ?? []);
    const order = viewOrders.get(idOf(view.id));
    const rowById = new Map(rows.map((row) => [idOf(row.id), row]));
    const pageIds = (order?.value ?? [])
      .filter((id) => rowById.has(idOf(id)))
      .slice(0, maxInlineRows);
    const viewRows = pageIds.flatMap((id) => rowById.get(idOf(id)) ?? []);
    return {
      columns: shown.length > 0 ? new Set(shown) : defaultColumns(schema, viewRows),
      rows: viewRows,
      order: order && { call: order, pageIds },
    };
  };

  const prune = async (dir: string): Promise<void> => {
    const pending = new Map<string, [Method, string, unknown]>();
    const rewrite = (method: Method, call: Recorded<unknown>, value: unknown) => {
      for (const arg of call.args) pending.set(`${method}:${arg}`, [method, arg, value]);
    };

    for (const [dataSourceId, query] of inlineRows) {
      if (rolesByDataSource.has(dataSourceId)) continue;
      const schemaCall = schemas.get(dataSourceId);
      const owners = [...databases.keys()].filter((blockId) => sourceOf(blockId) === dataSourceId);
      // Nothing on the site shows this table, so its placeholders stay.
      if (!schemaCall || owners.length === 0) continue;
      const schema = schemaCall.value;
      const nameById = new Map(
        Object.values(schema.properties).map((column) => [decode(column.id), column.name]),
      );
      const layouts = owners.map((blockId) => ({
        blockId,
        ...layoutOf(blockId, schema, query.value, nameById),
      }));

      const kept = new Map<string, { row: Row; columns: Set<string> }>();
      for (const layout of layouts)
        for (const row of layout.rows) {
          const seen = kept.get(idOf(row.id))?.columns ?? [];
          kept.set(idOf(row.id), { row, columns: new Set([...seen, ...layout.columns]) });
        }
      const rows = [...kept.values()].map(({ row, columns }) => rowFields(row, columns));
      const columns = new Set(layouts.flatMap((layout) => [...layout.columns]));
      rewrite('queryDataSource', query, rows);
      rewrite(
        'retrieveDataSource',
        schemaCall,
        schemaFields(schema, columns, rows, owners.some(showsSourceTitle)),
      );

      for (const layout of layouts) {
        const views = viewLists.get(layout.blockId);
        const keeps = (propertyId: string) => {
          const name = nameById.get(decode(propertyId));
          return name !== undefined && layout.columns.has(name);
        };
        if (views)
          rewrite(
            'listViews',
            views,
            views.value.map((view) => withColumns(view, keeps)),
          );
        if (layout.order) rewrite('queryViewPageIds', layout.order.call, layout.order.pageIds);
      }
    }

    for (const list of blockLists.values()) {
      const blocks = list.value.map((block) =>
        block.type === 'child_database' && !rendersTable(idOf(block.id)) ? untitled(block) : block,
      );
      rewrite('listBlockChildren', list, blocks);
    }

    await Promise.all(
      [...pending.values()].map(([method, arg, value]) => writeFixture(dir, method, arg, value)),
    );
  };

  return Object.assign(sanitize, { prune });
}
