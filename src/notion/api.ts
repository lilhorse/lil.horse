import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  collectAllDataSourceRows,
  collectPaginatedAPI,
  isFullBlock,
  isFullDatabase,
  isFullDataSource,
  isFullPage,
  isFullView,
  isHTTPResponseError,
  isNotionClientError,
} from '@notionhq/client';
import type {
  BlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import { normalizeId } from './ids';
import { RateLimiter } from './rate-limit';

export const NOTION_VERSION = '2026-03-11';

const MAX_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;

export interface NotionApi {
  retrieveDatabase(databaseId: string): Promise<DatabaseObjectResponse>;
  retrieveDataSource(dataSourceId: string): Promise<DataSourceObjectResponse>;
  queryDataSource(dataSourceId: string): Promise<PageObjectResponse[]>;
  latestEditedTime(dataSourceId: string): Promise<string | null>;
  retrievePage(pageId: string): Promise<PageObjectResponse>;
  listBlockChildren(blockId: string): Promise<BlockObjectResponse[]>;
  listViews(databaseId: string): Promise<DataSourceViewObjectResponse[]>;
  queryViewPageIds(viewId: string): Promise<string[]>;
}

export interface NotionApiOptions {
  token: string;
  limiter?: RateLimiter;
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

export function isNotFoundError(error: unknown): boolean {
  if (isNotionClientError(error)) return error.code === APIErrorCode.ObjectNotFound;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'object_not_found'
  );
}

function isTransientError(error: unknown): boolean {
  if (isHTTPResponseError(error)) return error.status === 429 || error.status >= 500;
  // fetch rejects with TypeError when the connection drops; every call here is a read.
  return isNotionClientError(error)
    ? error.code === ClientErrorCode.RequestTimeout
    : error instanceof TypeError;
}

function retryDelay(error: unknown, attempt: number, baseDelayMs: number): number {
  const retryAfter =
    isHTTPResponseError(error) && error.headers instanceof Headers
      ? Number(error.headers.get('retry-after'))
      : NaN;
  if (retryAfter > 0) return Math.min(retryAfter * 1_000, MAX_RETRY_DELAY_MS);
  const delay = baseDelayMs * 2 ** attempt;
  return Math.min(delay / 2 + Math.random() * delay, MAX_RETRY_DELAY_MS);
}

async function withRetry<T>(task: () => Promise<T>, baseDelayMs: number): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isTransientError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(error, attempt, baseDelayMs)));
    }
  }
}

export function createNotionApi(options: NotionApiOptions): NotionApi {
  const client = new Client({
    auth: options.token,
    notionVersion: NOTION_VERSION,
    timeoutMs: 30_000,
    // withRetry replaces the SDK retry, which skips 5xx on POST; every call here is a read.
    retry: false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  // 180 requests per minute per connection is Notion's free-plan budget.
  const limiter = options.limiter ?? new RateLimiter({ concurrency: 3, minIntervalMs: 340 });
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const run = <T>(task: () => Promise<T>): Promise<T> =>
    withRetry(() => limiter.schedule(task), retryDelayMs);

  const limitedClient = {
    dataSources: {
      ...client.dataSources,
      query: (args: Parameters<typeof client.dataSources.query>[0]) =>
        run(() => client.dataSources.query(args)),
    },
  } as Pick<Client, 'dataSources'>;

  return {
    async retrieveDatabase(databaseId) {
      const response = await run(() => client.databases.retrieve({ database_id: databaseId }));
      if (!isFullDatabase(response))
        throw new Error(`Database ${databaseId} returned a partial object`);
      return response;
    },

    async retrieveDataSource(dataSourceId) {
      const response = await run(() =>
        client.dataSources.retrieve({ data_source_id: dataSourceId }),
      );
      if (!isFullDataSource(response))
        throw new Error(`Data source ${dataSourceId} returned a partial object`);
      return response;
    },

    async queryDataSource(dataSourceId) {
      const rows = await collectAllDataSourceRows(limitedClient, { data_source_id: dataSourceId });
      return rows.filter(isFullPage).filter((row) => !row.in_trash);
    },

    async latestEditedTime(dataSourceId) {
      const response = await run(() =>
        client.dataSources.query({
          data_source_id: dataSourceId,
          sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
          page_size: 1,
        }),
      );
      return response.results.find(isFullPage)?.last_edited_time ?? null;
    },

    async retrievePage(pageId) {
      const response = await run(() => client.pages.retrieve({ page_id: pageId }));
      if (!isFullPage(response)) throw new Error(`Page ${pageId} returned a partial object`);
      return response;
    },

    async listBlockChildren(blockId) {
      const blocks = await collectPaginatedAPI(
        (args: { block_id: string; start_cursor?: string; page_size?: number }) =>
          run(() => client.blocks.children.list(args)),
        { block_id: blockId, page_size: 100 },
      );
      return blocks.filter(isFullBlock).filter((item) => !item.in_trash);
    },

    async listViews(databaseId) {
      const references = await collectPaginatedAPI(
        (args: { database_id: string; start_cursor?: string }) =>
          run(() => client.views.list(args)),
        { database_id: databaseId },
      );
      const views = await Promise.all(
        references.map((reference) => run(() => client.views.retrieve({ view_id: reference.id }))),
      );
      return views.filter(isFullView);
    },

    async queryViewPageIds(viewId) {
      const first = await run(() => client.views.queries.create({ view_id: viewId }));
      const ids = first.results.map((result) => normalizeId(result.id));
      let hasMore = first.has_more;
      let cursor = first.next_cursor;
      while (hasMore && cursor) {
        const startCursor = cursor;
        const page = await run(() =>
          client.views.queries.results({
            view_id: viewId,
            query_id: first.id,
            start_cursor: startCursor,
          }),
        );
        ids.push(...page.results.map((result) => normalizeId(result.id)));
        hasMore = page.has_more;
        cursor = page.next_cursor;
      }
      return ids;
    },
  };
}
