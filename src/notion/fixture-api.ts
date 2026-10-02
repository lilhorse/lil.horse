import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFoundError, type NotionApi } from './api';

type Method = keyof NotionApi;

const NOT_FOUND_MARKER = { __notFound: true };

export function fixtureKey(method: Method, arg: string): string {
  return `${method}-${createHash('sha256').update(arg).digest('hex').slice(0, 16)}`;
}

const fixturePath = (dir: string, method: Method, arg: string) =>
  join(dir, `${fixtureKey(method, arg)}.json`);

export async function writeFixture(
  dir: string,
  method: Method,
  arg: string,
  value: unknown,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(fixturePath(dir, method, arg), `${JSON.stringify(value, null, 2)}\n`);
}

function isNotFoundMarker(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__notFound' in value &&
    value.__notFound === true
  );
}

export function createFixtureApi(dir: string): NotionApi {
  const read = async <T>(method: Method, arg: string): Promise<T> => {
    const file = fixturePath(dir, method, arg);
    const where = `${method}(${arg}) at ${file}`;
    const text = await readFile(file, 'utf8').catch((error: unknown) => {
      throw new Error(`Missing Notion fixture for ${where}`, { cause: error });
    });
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON in Notion fixture for ${where}`, { cause: error });
    }
    if (isNotFoundMarker(value))
      throw Object.assign(new Error(`Notion returned object_not_found for ${where}`), {
        code: 'object_not_found',
      });
    return value as T;
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
  sanitize: (method: Method, arg: string, value: unknown) => unknown,
): NotionApi {
  const record =
    <R>(method: Method, call: (arg: string) => Promise<R>) =>
    async (arg: string): Promise<R> => {
      const value = await call(arg).catch(async (error: unknown) => {
        if (isNotFoundError(error)) await writeFixture(dir, method, arg, NOT_FOUND_MARKER);
        throw error;
      });
      await writeFixture(dir, method, arg, sanitize(method, arg, value));
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
