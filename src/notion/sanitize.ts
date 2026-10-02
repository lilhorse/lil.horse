import type {
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import type { NotionApi } from './api';
import { writeFixture } from './fixture-api';
import { normalizeId, parseId } from './ids';
import type { DatabaseDisplay } from './types';

type Method = keyof NotionApi;
type Schema = DataSourceObjectResponse;
type View = DataSourceViewObjectResponse;
type Row = PageObjectResponse;

export interface FixtureSanitizer {
  (method: Method, arg: string, value: unknown): unknown;
  /** Rewrites recorded inline tables down to the rows and columns the site renders. */
  prune(dir: string): Promise<void>;
}

const NOTION_FILE_HOST =
  /(^|\.)(amazonaws\.com|notion-static\.com|notionusercontent\.com)$|^file\.notion\.so$/;
const ANONYMOUS_USER = { object: 'user', id: '00000000-0000-0000-0000-000000000000' };

function stripSignedQuery(value: string): string {
  if (!/^https?:\/\//.test(value)) return value;
  try {
    const url = new URL(value);
    if (!NOTION_FILE_HOST.test(url.hostname)) return value;
    url.search = '';
    return url.toString();
  } catch {
    return value;
  }
}

const isFilled = (value: unknown) =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0;

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === 'string') return stripSignedQuery(value);
  if (value === null || typeof value !== 'object') return value;
  if ('object' in value && value.object === 'user') return ANONYMOUS_USER;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'request_id') continue;
    // `{}` here is a schema's column config, not a user.
    const isUser = (key === 'created_by' || key === 'last_edited_by') && isFilled(child);
    out[key] = isUser ? ANONYMOUS_USER : scrub(child);
  }
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

// Filters can name people and emails, and the site never reads them.
function withoutFilters(view: View): View {
  const copy = { ...view };
  delete copy.filter;
  delete copy.quick_filters;
  return copy;
}

function pick<T>(record: Record<string, T>, names: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => names.has(name)));
}

// null keeps every column.
type Columns = Set<string> | null;

const union = (a: Columns, b: Columns): Columns => a && b && new Set([...a, ...b]);

function pruneView(view: View, keeps: (propertyId: string) => boolean): View {
  const copy = withoutFilters(view);
  const configuration = copy.configuration;
  if (configuration && 'properties' in configuration && configuration.properties)
    copy.configuration = {
      ...configuration,
      properties: configuration.properties.filter((column) => keeps(column.property_id)),
    };
  return copy;
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
  columns: Columns;
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
  const databases: Calls<DatabaseObjectResponse> = new Map();
  const viewLists: Calls<View[]> = new Map();
  const schemas: Calls<Schema> = new Map();
  const inlineRows: Calls<Row[]> = new Map();
  const viewOrders: Calls<string[]> = new Map();

  const sanitize = (method: Method, arg: string, value: unknown): unknown => {
    const clean = scrub(value);
    switch (method) {
      case 'retrieveDatabase': {
        const database = clean as DatabaseObjectResponse;
        const role = rolesByDatabase.get(idOf(arg));
        if (role)
          for (const source of database.data_sources) rolesByDataSource.set(idOf(source.id), role);
        remember(databases, arg, database);
        return database;
      }
      case 'listViews': {
        const views = (clean as View[]).map(withoutFilters);
        remember(viewLists, arg, views);
        return views;
      }
      case 'retrieveDataSource':
        remember(schemas, arg, clean as Schema);
        return clean;
      case 'queryDataSource': {
        const rows = clean as Row[];
        const role = rolesByDataSource.get(idOf(arg));
        if (!role) remember(inlineRows, arg, rows);
        const kept = role
          ? rows.filter((row) => isPublicRow(role, row))
          : rows.slice(0, maxInlineRows);
        for (const row of kept) keptRowIds.add(idOf(row.id));
        return kept;
      }
      case 'queryViewPageIds': {
        const pageIds = clean as string[];
        remember(viewOrders, arg, pageIds);
        return pageIds.filter((id) => keptRowIds.has(idOf(id)));
      }
      default:
        return clean;
    }
  };

  // Keep in sync with how buildDatabaseNode finds a block's data source.
  const readsFrom = (blockId: string, dataSourceId: string): boolean => {
    const sources = (databases.get(blockId)?.value.data_sources ?? []).map((source) => source.id);
    const views = viewLists.get(blockId)?.value ?? [];
    const sourceView = views.find((view) => view.type === 'table') ?? views[0];
    if (sourceView?.data_source_id) sources.push(sourceView.data_source_id);
    return sources.some((id) => idOf(id) === dataSourceId);
  };

  // Keep in sync with how buildDatabaseNode picks columns and rows.
  const layoutOf = (
    blockId: string | undefined,
    schema: Schema,
    rows: Row[],
    nameById: Map<string, string>,
  ): Layout => {
    const title = Object.values(schema.properties).find((property) => property.type === 'title');
    const withTitle = (names: string[]) => new Set(title ? [title.name, ...names] : names);
    const firstRows = rows.slice(0, maxInlineRows);
    const display = blockId === undefined ? undefined : ids.databaseDisplay?.[blockId];
    if (display) {
      const names = display.columns.map((column) => column.property);
      // The site sorts rows by this column, so keep it even when it is not shown.
      if (display.sort) names.push(display.sort.property);
      return { columns: withTitle(names), rows: firstRows };
    }
    const views = blockId === undefined ? [] : (viewLists.get(blockId)?.value ?? []);
    const view = views.find((item) => item.type === 'table');
    const configured =
      view?.configuration?.type === 'table' ? (view.configuration.properties ?? []) : [];
    const columns =
      configured.length === 0
        ? null
        : withTitle(
            configured
              .filter((column) => column.visible !== false)
              .flatMap((column) => nameById.get(decode(column.property_id)) ?? []),
          );
    const order = view && viewOrders.get(idOf(view.id));
    if (!order) return { columns, rows: firstRows };
    const rowById = new Map(rows.map((row) => [idOf(row.id), row]));
    const pageIds = order.value.filter((id) => rowById.has(idOf(id))).slice(0, maxInlineRows);
    return {
      columns,
      rows: pageIds.flatMap((id) => rowById.get(idOf(id)) ?? []),
      order: { call: order, pageIds },
    };
  };

  const prune = async (dir: string): Promise<void> => {
    const pending = new Map<string, [Method, string, unknown]>();
    const rewrite = (method: Method, call: Recorded<unknown> | undefined, value: unknown) => {
      for (const arg of call?.args ?? []) pending.set(`${method}:${arg}`, [method, arg, value]);
    };
    const blockIds = new Set([...databases.keys(), ...viewLists.keys()]);

    for (const [dataSourceId, query] of inlineRows) {
      if (rolesByDataSource.has(dataSourceId)) continue;
      const schemaCall = schemas.get(dataSourceId);
      if (!schemaCall) {
        // Without a schema the site skips the table.
        rewrite('queryDataSource', query, []);
        continue;
      }
      const schema = schemaCall.value;
      const nameById = new Map(
        Object.values(schema.properties).map((property) => [decode(property.id), property.name]),
      );
      const owners = [...blockIds].filter((blockId) => readsFrom(blockId, dataSourceId));
      const layouts = (owners.length > 0 ? owners : [undefined]).map((blockId) => ({
        blockId,
        ...layoutOf(blockId, schema, query.value, nameById),
      }));

      const kept = new Map<string, { row: Row; columns: Columns }>();
      for (const layout of layouts)
        for (const row of layout.rows) {
          const seen = kept.get(idOf(row.id));
          const columns = seen ? union(seen.columns, layout.columns) : layout.columns;
          kept.set(idOf(row.id), { row, columns });
        }
      rewrite(
        'queryDataSource',
        query,
        [...kept.values()].map(({ row, columns }) =>
          columns ? { ...row, properties: pick(row.properties, columns) } : row,
        ),
      );

      const schemaColumns = layouts.reduce<Columns>(
        (all, layout) => union(all, layout.columns),
        new Set(),
      );
      if (schemaColumns)
        rewrite('retrieveDataSource', schemaCall, {
          ...schema,
          properties: pick(schema.properties, schemaColumns),
        });

      for (const { blockId, columns, order } of layouts) {
        const views = blockId === undefined ? undefined : viewLists.get(blockId);
        const keeps = (propertyId: string) => {
          const name = nameById.get(decode(propertyId));
          return columns === null || (name !== undefined && columns.has(name));
        };
        if (views)
          rewrite(
            'listViews',
            views,
            views.value.map((view) => pruneView(view, keeps)),
          );
        if (order) rewrite('queryViewPageIds', order.call, order.pageIds);
      }
    }

    await Promise.all(
      [...pending.values()].map(([method, arg, value]) => writeFixture(dir, method, arg, value)),
    );
  };

  return Object.assign(sanitize, { prune });
}
