import type { PageObjectResponse, RichTextItemResponse } from '@notionhq/client';

export type Properties = PageObjectResponse['properties'];
export type PageProperty = Properties[string];

export class PropertyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropertyError';
  }
}

function find(
  props: Properties,
  name: string,
  types: readonly PageProperty['type'][],
): PageProperty | null {
  const value = props[name];
  if (value === undefined) return null;
  if (!types.includes(value.type))
    throw new PropertyError(`expected ${types.join(' or ')}, found ${value.type}`);
  return value;
}

export function plainText(items: RichTextItemResponse[]): string {
  return items.map((item) => item.plain_text).join('');
}

export function readTitle(props: Properties): string {
  const value = Object.values(props).find((candidate) => candidate.type === 'title');
  return value?.type === 'title' ? plainText(value.title).trim() : '';
}

export function readText(props: Properties, name: string): string | null {
  const value = find(props, name, ['rich_text']);
  if (value?.type !== 'rich_text') return null;
  return plainText(value.rich_text).trim() || null;
}

export function readOption(props: Properties, name: string): string | null {
  const value = find(props, name, ['select', 'status']);
  if (value?.type === 'select') return value.select?.name ?? null;
  if (value?.type === 'status') return value.status?.name ?? null;
  return null;
}

export function readOptions(props: Properties, name: string): string[] {
  const value = find(props, name, ['multi_select']);
  return value?.type === 'multi_select' ? value.multi_select.map((option) => option.name) : [];
}

export function datePart(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match?.[1]) throw new PropertyError(`invalid date "${value}"`);
  return match[1];
}

export function readDate(
  props: Properties,
  name: string,
): { start: string; end: string | null } | null {
  const value = find(props, name, ['date']);
  if (value?.type !== 'date' || !value.date) return null;
  return {
    start: datePart(value.date.start),
    end: value.date.end ? datePart(value.date.end) : null,
  };
}

export function readCheckbox(props: Properties, name: string): boolean {
  const value = find(props, name, ['checkbox']);
  return value?.type === 'checkbox' ? value.checkbox : false;
}

export function readNumber(props: Properties, name: string): number | null {
  const value = find(props, name, ['number']);
  return value?.type === 'number' ? value.number : null;
}

export function readUrl(props: Properties, name: string): string | null {
  const value = find(props, name, ['url']);
  return value?.type === 'url' ? value.url : null;
}

export function readEmail(props: Properties, name: string): string | null {
  const value = find(props, name, ['email']);
  return value?.type === 'email' ? value.email : null;
}

export function coverUrl(page: PageObjectResponse): string | null {
  const cover = page.cover;
  if (!cover) return null;
  if (cover.type === 'external') return cover.external.url;
  if (cover.type === 'file') return cover.file.url;
  return null;
}
