import type { DatabaseObjectResponse, PageObjectResponse } from '@notionhq/client';
import type { NotionApi } from './api';
import { normalizeId } from './ids';

export type FixtureSanitizer = (method: keyof NotionApi, arg: string, value: unknown) => unknown;

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

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === 'string') return stripSignedQuery(value);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'request_id') continue;
    out[key] = key === 'created_by' || key === 'last_edited_by' ? ANONYMOUS_USER : scrub(child);
  }
  if (out.type === 'people' && Array.isArray(out.people)) out.people = [];
  if (out.type === 'email' && typeof out.email === 'string') out.email = 'hello@example.com';
  if (out.type === 'user' && typeof out.user === 'object' && out.user !== null)
    out.user = ANONYMOUS_USER;
  const mention = out.mention as { type?: string } | undefined;
  if (out.type === 'mention' && mention?.type === 'user') out.plain_text = '@someone';
  return out;
}

type Role = 'posts' | 'projects' | 'profile';

function isPublicRow(role: Role, row: PageObjectResponse): boolean {
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

export function createFixtureSanitizer(
  ids: { postsDatabaseId: string; projectsDatabaseId: string; profileDatabaseId: string },
  maxInlineRows = 25,
): FixtureSanitizer {
  const rolesByDatabase = new Map<string, Role>([
    [normalizeId(ids.postsDatabaseId), 'posts'],
    [normalizeId(ids.projectsDatabaseId), 'projects'],
    [normalizeId(ids.profileDatabaseId), 'profile'],
  ]);
  const rolesByDataSource = new Map<string, Role>();
  const keptRowIds = new Set<string>();

  return (method, arg, value) => {
    let result = value;
    if (method === 'retrieveDatabase') {
      const role = rolesByDatabase.get(normalizeId(arg));
      if (role)
        for (const source of (value as DatabaseObjectResponse).data_sources)
          rolesByDataSource.set(normalizeId(source.id), role);
    }
    if (method === 'queryDataSource') {
      const rows = value as PageObjectResponse[];
      const role = rolesByDataSource.get(normalizeId(arg));
      const kept = role
        ? rows.filter((row) => isPublicRow(role, row))
        : rows.slice(0, maxInlineRows);
      for (const row of kept) keptRowIds.add(normalizeId(row.id));
      result = kept;
    }
    if (method === 'queryViewPageIds')
      result = (value as string[]).filter((id) => keptRowIds.has(normalizeId(id)));
    return scrub(result);
  };
}
