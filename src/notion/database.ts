// Keep the fields read here in sync with the fixture whitelist in src/notion/sanitize.ts.
import type {
  ChildDatabaseBlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import { isNotFoundError, type NotionApi } from './api';
import { normalizeId } from './ids';
import type { MediaStore } from './media';
import { datePart, plainText, type PageProperty } from './properties';
import { toRichText } from './rich-text';
import type {
  DatabaseDisplay,
  DatabaseNode,
  DbCell,
  DbColumn,
  DbRow,
  NotionColor,
  RichText,
} from './types';

export interface DatabaseDeps {
  api: NotionApi;
  media: MediaStore;
  display: Record<string, DatabaseDisplay>;
  warn: (message: string) => void;
  onDataSource: (dataSourceId: string) => void;
}

type SchemaProperty = DataSourceObjectResponse['properties'][string];

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
const PLAIN = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default' as const,
};

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toColumn(property: SchemaProperty, format: 'stars' | null = null): DbColumn {
  return { id: property.id, name: property.name, type: property.type, format };
}

function plainCell(text: string): RichText {
  return [{ kind: 'text', text, annotations: { ...PLAIN }, href: null, pageId: null }];
}

function isEmptyValue(value: PageProperty | undefined): boolean {
  if (!value) return true;
  switch (value.type) {
    case 'title':
      return value.title.length === 0;
    case 'rich_text':
      return value.rich_text.length === 0;
    case 'number':
      return value.number === null;
    case 'select':
      return value.select === null;
    case 'status':
      return value.status === null;
    case 'multi_select':
      return value.multi_select.length === 0;
    case 'date':
      return value.date === null;
    case 'url':
      return !value.url;
    case 'email':
      return !value.email;
    case 'files':
      return value.files.length === 0;
    case 'checkbox':
    case 'created_time':
    case 'last_edited_time':
      return false;
    default:
      return true;
  }
}

function sortKey(value: PageProperty | undefined): string | number | null {
  if (!value || isEmptyValue(value)) return null;
  switch (value.type) {
    case 'date':
      return value.date?.start ?? null;
    case 'number':
      return value.number;
    case 'title':
      return plainText(value.title);
    case 'rich_text':
      return plainText(value.rich_text);
    case 'select':
      return value.select?.name ?? null;
    case 'status':
      return value.status?.name ?? null;
    case 'multi_select':
      return value.multi_select[0]?.name ?? null;
    case 'created_time':
      return value.created_time;
    case 'last_edited_time':
      return value.last_edited_time;
    default:
      return null;
  }
}

function sortRows(
  rows: PageObjectResponse[],
  sort: NonNullable<DatabaseDisplay['sort']>,
): PageObjectResponse[] {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortKey(a.properties[sort.property]);
    const right = sortKey(b.properties[sort.property]);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

function defaultColumns(schema: SchemaProperty[], rows: PageObjectResponse[]): DbColumn[] {
  const title = schema.find((property) => property.type === 'title');
  const others = schema
    .filter(
      (property) =>
        property.type !== 'title' &&
        rows.some((row) => !isEmptyValue(row.properties[property.name])),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...(title ? [toColumn(title)] : []), ...others.map((property) => toColumn(property))];
}

function starValue(value: PageProperty): number | null {
  let raw: string | number | null = null;
  if (value.type === 'number') raw = value.number;
  else if (value.type === 'select') raw = value.select?.name ?? null;
  else if (value.type === 'multi_select') raw = value.multi_select[0]?.name ?? null;
  else if (value.type === 'rich_text') raw = plainText(value.rich_text);
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0, Math.round(parsed))) : null;
}

async function toCell(
  value: PageProperty | undefined,
  column: DbColumn,
  media: MediaStore,
): Promise<DbCell> {
  if (!value) return { kind: 'empty' };
  if (column.format === 'stars') {
    const stars = starValue(value);
    return stars === null ? { kind: 'empty' } : { kind: 'stars', value: stars };
  }
  switch (value.type) {
    case 'title':
      return value.title.length
        ? { kind: 'text', text: toRichText(value.title) }
        : { kind: 'empty' };
    case 'rich_text':
      return value.rich_text.length
        ? { kind: 'text', text: toRichText(value.rich_text) }
        : { kind: 'empty' };
    case 'number':
      return value.number === null ? { kind: 'empty' } : { kind: 'number', value: value.number };
    case 'select':
      return value.select
        ? {
            kind: 'chips',
            values: [{ name: value.select.name, color: value.select.color as NotionColor }],
          }
        : { kind: 'empty' };
    case 'status':
      return value.status
        ? {
            kind: 'chips',
            values: [{ name: value.status.name, color: value.status.color as NotionColor }],
          }
        : { kind: 'empty' };
    case 'multi_select':
      return value.multi_select.length
        ? {
            kind: 'chips',
            values: value.multi_select.map((option) => ({
              name: option.name,
              color: option.color as NotionColor,
            })),
          }
        : { kind: 'empty' };
    case 'date':
      return value.date
        ? {
            kind: 'date',
            start: datePart(value.date.start),
            end: value.date.end ? datePart(value.date.end) : null,
          }
        : { kind: 'empty' };
    case 'checkbox':
      return { kind: 'checkbox', value: value.checkbox };
    case 'url':
      return value.url ? { kind: 'url', url: value.url } : { kind: 'empty' };
    case 'email':
      return value.email ? { kind: 'text', text: plainCell(value.email) } : { kind: 'empty' };
    case 'files': {
      const images = value.files
        .map((file) => ({
          name: file.name,
          url:
            file.type === 'external'
              ? file.external.url
              : file.type === 'file'
                ? file.file.url
                : '',
        }))
        .filter((file) => file.url && (IMAGE_FILE.test(file.name) || IMAGE_FILE.test(file.url)));
      if (images.length === 0) return { kind: 'empty' };
      return {
        kind: 'media',
        items: await Promise.all(
          images.map((file) => media.ensure(file.url, { kind: 'image', fileNameHint: file.name })),
        ),
      };
    }
    case 'created_time':
      return { kind: 'date', start: datePart(value.created_time), end: null };
    case 'last_edited_time':
      return { kind: 'date', start: datePart(value.last_edited_time), end: null };
    default:
      return { kind: 'empty' };
  }
}

async function resolveLayout(
  databaseId: string,
  schema: SchemaProperty[],
  rows: PageObjectResponse[],
  deps: DatabaseDeps,
  views?: DataSourceViewObjectResponse[],
): Promise<{ columns: DbColumn[]; ordered: PageObjectResponse[] }> {
  const override = deps.display[databaseId];
  if (override) {
    const byName = new Map(schema.map((property) => [property.name, property]));
    const columns = override.columns.flatMap((column) => {
      const property = byName.get(column.property);
      if (!property) {
        deps.warn(
          `Inline database ${databaseId}: configured property "${column.property}" does not exist`,
        );
        return [];
      }
      return [toColumn(property, column.format ?? null)];
    });
    return { columns, ordered: override.sort ? sortRows(rows, override.sort) : rows };
  }

  const view = (views ?? (await deps.api.listViews(databaseId))).find(
    (candidate) => candidate.type === 'table',
  );
  if (!view) return { columns: defaultColumns(schema, rows), ordered: rows };

  const byId = new Map(schema.map((property) => [decode(property.id), property]));
  const configured =
    view.configuration?.type === 'table' ? (view.configuration.properties ?? []) : [];
  const columns = configured
    .filter((column) => column.visible !== false)
    .flatMap((column) => {
      const property = byId.get(decode(column.property_id));
      return property ? [toColumn(property)] : [];
    });
  const order = await deps.api.queryViewPageIds(view.id);
  const position = new Map(order.map((id, index) => [normalizeId(id), index]));
  const ordered = rows
    .filter((row) => position.has(normalizeId(row.id)))
    .sort(
      (a, b) => (position.get(normalizeId(a.id)) ?? 0) - (position.get(normalizeId(b.id)) ?? 0),
    );
  return { columns: columns.length > 0 ? columns : defaultColumns(schema, rows), ordered };
}

export async function buildDatabaseNode(
  block: ChildDatabaseBlockObjectResponse,
  deps: DatabaseDeps,
): Promise<DatabaseNode | null> {
  const databaseId = normalizeId(block.id);
  const blockTitle = block.child_database.title;
  let database: DatabaseObjectResponse;
  try {
    database = await deps.api.retrieveDatabase(databaseId);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    deps.warn(
      `Inline database "${blockTitle}" (${databaseId}) is not shared with the integration; skipped`,
    );
    return null;
  }
  // A linked view has no data source of its own; its views point at the source.
  const views =
    database.data_sources.length === 0 ? await deps.api.listViews(databaseId) : undefined;
  const sourceView = views?.find((view) => view.type === 'table') ?? views?.[0];
  const reference = database.data_sources[0]?.id ?? sourceView?.data_source_id;
  if (!reference) {
    deps.warn(`Inline database "${blockTitle}" (${databaseId}) has no data source; skipped`);
    return null;
  }
  const dataSourceId = normalizeId(reference);
  let dataSource: DataSourceObjectResponse;
  let rows: PageObjectResponse[];
  try {
    [dataSource, rows] = await Promise.all([
      deps.api.retrieveDataSource(dataSourceId),
      deps.api.queryDataSource(dataSourceId),
    ]);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    deps.warn(
      `Inline database "${blockTitle}" (${databaseId}) reads data source ${dataSourceId}, which is not shared with the integration; skipped`,
    );
    return null;
  }
  deps.onDataSource(dataSourceId);
  // The API titles an unnamed linked view "Untitled"; Notion shows the source's name.
  const title =
    blockTitle === '' || blockTitle === 'Untitled'
      ? plainText(dataSource.title) || blockTitle
      : blockTitle;
  const { columns, ordered } = await resolveLayout(
    databaseId,
    Object.values(dataSource.properties),
    rows,
    deps,
    views,
  );
  const dbRows: DbRow[] = [];
  for (const row of ordered) {
    const cells: Record<string, DbCell> = {};
    for (const column of columns)
      cells[column.id] = await toCell(row.properties[column.name], column, deps.media);
    dbRows.push({ id: normalizeId(row.id), cells });
  }
  return { type: 'database', id: block.id, title, columns, rows: dbRows };
}
