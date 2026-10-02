import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NotionApi } from './api';
import type { FixtureSanitizer } from './sanitize';

type Method = keyof NotionApi;

export function fixtureKey(method: Method, arg: string): string {
  return `${method}-${createHash('sha256').update(arg).digest('hex').slice(0, 16)}`;
}

export function createFixtureApi(dir: string): NotionApi {
  const read = async <T>(method: Method, arg: string): Promise<T> => {
    const file = join(dir, `${fixtureKey(method, arg)}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (error) {
      throw new Error(`Missing Notion fixture for ${method}(${arg}) at ${file}`, { cause: error });
    }
  };
  return {
    retrieveDatabase: (id) => read('retrieveDatabase', id),
    retrieveDataSource: (id) => read('retrieveDataSource', id),
    queryDataSource: (id) => read('queryDataSource', id),
    latestEditedTime: (id) => read('latestEditedTime', id),
    retrievePage: (id) => read('retrievePage', id),
    listBlockChildren: (id) => read('listBlockChildren', id),
    listViews: (id) => read('listViews', id),
    queryViewPageIds: (id) => read('queryViewPageIds', id),
  };
}

export function createRecordingApi(
  inner: NotionApi,
  dir: string,
  sanitize: FixtureSanitizer,
): NotionApi {
  const record =
    <R>(method: Method, call: (arg: string) => Promise<R>) =>
    async (arg: string): Promise<R> => {
      const value = await call(arg);
      await mkdir(dir, { recursive: true });
      const body = `${JSON.stringify(sanitize(method, arg, value), null, 2)}\n`;
      await writeFile(join(dir, `${fixtureKey(method, arg)}.json`), body);
      return value;
    };
  return {
    retrieveDatabase: record('retrieveDatabase', (id) => inner.retrieveDatabase(id)),
    retrieveDataSource: record('retrieveDataSource', (id) => inner.retrieveDataSource(id)),
    queryDataSource: record('queryDataSource', (id) => inner.queryDataSource(id)),
    latestEditedTime: record('latestEditedTime', (id) => inner.latestEditedTime(id)),
    retrievePage: record('retrievePage', (id) => inner.retrievePage(id)),
    listBlockChildren: record('listBlockChildren', (id) => inner.listBlockChildren(id)),
    listViews: record('listViews', (id) => inner.listViews(id)),
    queryViewPageIds: record('queryViewPageIds', (id) => inner.queryViewPageIds(id)),
  };
}
