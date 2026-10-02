import type {
  BlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client';

const USER = { object: 'user', id: '00000000-0000-0000-0000-000000000000' };
const ANNOTATIONS = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
};

let counter = 0;
export function nextId(): string {
  counter += 1;
  return counter.toString(16).padStart(32, 'a');
}

export function rt(
  text: string,
  options: { href?: string; annotations?: Partial<typeof ANNOTATIONS> } = {},
): RichTextItemResponse {
  return {
    type: 'text',
    text: { content: text, link: options.href ? { url: options.href } : null },
    annotations: { ...ANNOTATIONS, ...options.annotations },
    plain_text: text,
    href: options.href ?? null,
  } as unknown as RichTextItemResponse;
}

export function mention(
  mentionValue: Record<string, unknown>,
  plainText: string,
): RichTextItemResponse {
  return {
    type: 'mention',
    mention: mentionValue,
    annotations: { ...ANNOTATIONS },
    plain_text: plainText,
    href: null,
  } as unknown as RichTextItemResponse;
}

export function equation(expression: string): RichTextItemResponse {
  return {
    type: 'equation',
    equation: { expression },
    annotations: { ...ANNOTATIONS },
    plain_text: expression,
    href: null,
  } as unknown as RichTextItemResponse;
}

export function block(
  type: string,
  data: Record<string, unknown>,
  options: { id?: string; hasChildren?: boolean; inTrash?: boolean } = {},
): BlockObjectResponse {
  return {
    object: 'block',
    id: options.id ?? nextId(),
    type,
    [type]: data,
    has_children: options.hasChildren ?? false,
    in_trash: options.inTrash ?? false,
    archived: options.inTrash ?? false,
    created_time: '2024-01-01T00:00:00.000Z',
    last_edited_time: '2024-01-01T00:00:00.000Z',
    created_by: USER,
    last_edited_by: USER,
    parent: { type: 'page_id', page_id: 'parent' },
  } as unknown as BlockObjectResponse;
}

export const prop = {
  title: (text: string) => ({ id: 'title', type: 'title', title: text ? [rt(text)] : [] }),
  text: (text: string) => ({ type: 'rich_text', rich_text: text ? [rt(text)] : [] }),
  status: (name: string | null) => ({
    type: 'status',
    status: name ? { id: name, name, color: 'default' } : null,
  }),
  select: (name: string | null) => ({
    type: 'select',
    select: name ? { id: name, name, color: 'default' } : null,
  }),
  multiSelect: (names: string[]) => ({
    type: 'multi_select',
    multi_select: names.map((name) => ({ id: name, name, color: 'blue' })),
  }),
  date: (start: string | null, end: string | null = null) => ({
    type: 'date',
    date: start ? { start, end, time_zone: null } : null,
  }),
  checkbox: (value: boolean) => ({ type: 'checkbox', checkbox: value }),
  number: (value: number | null) => ({ type: 'number', number: value }),
  url: (value: string | null) => ({ type: 'url', url: value }),
  email: (value: string | null) => ({ type: 'email', email: value }),
  files: (urls: string[]) => ({
    type: 'files',
    files: urls.map((url) => ({ type: 'external', name: url.split('/').pop(), external: { url } })),
  }),
};

export function page(
  properties: Record<string, Record<string, unknown>>,
  options: { id?: string; lastEdited?: string; cover?: string | null; inTrash?: boolean } = {},
): PageObjectResponse {
  const withIds = Object.fromEntries(
    Object.entries(properties).map(([name, value], index) => [name, { id: `p${index}`, ...value }]),
  );
  return {
    object: 'page',
    id: options.id ?? nextId(),
    properties: withIds,
    created_time: '2024-01-01T00:00:00.000Z',
    last_edited_time: options.lastEdited ?? '2024-02-01T00:00:00.000Z',
    cover: options.cover ? { type: 'external', external: { url: options.cover } } : null,
    icon: null,
    in_trash: options.inTrash ?? false,
    archived: options.inTrash ?? false,
    is_locked: false,
    url: 'https://www.notion.so/page',
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds' },
    created_by: USER,
    last_edited_by: USER,
  } as unknown as PageObjectResponse;
}

export function database(
  databaseId: string,
  dataSourceId: string,
  title = 'Database',
): DatabaseObjectResponse {
  return {
    object: 'database',
    id: databaseId,
    title: [rt(title)],
    is_inline: true,
    data_sources: [{ id: dataSourceId, name: title }],
  } as unknown as DatabaseObjectResponse;
}

export function dataSource(
  dataSourceId: string,
  properties: Record<string, { id: string; type: string }>,
): DataSourceObjectResponse {
  const withNames = Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, { ...value, name, [value.type]: {} }]),
  );
  return {
    object: 'data_source',
    id: dataSourceId,
    properties: withNames,
    title: [],
  } as unknown as DataSourceObjectResponse;
}

export function tableView(
  viewId: string,
  columns: { property_id: string; visible?: boolean }[],
): DataSourceViewObjectResponse {
  return {
    object: 'view',
    id: viewId,
    type: 'table',
    name: 'Table',
    configuration: { type: 'table', properties: columns },
  } as unknown as DataSourceViewObjectResponse;
}
