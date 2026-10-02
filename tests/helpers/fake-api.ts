import type {
  BlockObjectResponse,
  DatabaseObjectResponse,
  DataSourceObjectResponse,
  DataSourceViewObjectResponse,
  PageObjectResponse,
} from '@notionhq/client';
import type { NotionApi } from '../../src/notion/api';
import { normalizeId } from '../../src/notion/ids';

function notFound(method: string, id: string): Error {
  return Object.assign(new Error(`not found: ${method}(${id})`), { code: 'object_not_found' });
}

export class FakeNotionApi implements NotionApi {
  readonly databases = new Map<string, DatabaseObjectResponse>();
  readonly dataSources = new Map<string, DataSourceObjectResponse>();
  readonly rows = new Map<string, PageObjectResponse[]>();
  readonly children = new Map<string, BlockObjectResponse[]>();
  readonly pages = new Map<string, PageObjectResponse>();
  readonly views = new Map<string, DataSourceViewObjectResponse[]>();
  readonly viewOrders = new Map<string, string[]>();
  readonly latest = new Map<string, string | null>();
  readonly calls: string[] = [];

  setChildren(parentId: string, blocks: BlockObjectResponse[]): void {
    this.children.set(normalizeId(parentId), blocks);
  }

  #lookup<T>(map: Map<string, T>, method: string, id: string): T {
    this.calls.push(`${method}:${normalizeId(id)}`);
    const value = map.get(normalizeId(id));
    if (value === undefined) throw notFound(method, id);
    return value;
  }

  async retrieveDatabase(id: string) {
    return this.#lookup(this.databases, 'retrieveDatabase', id);
  }

  async retrieveDataSource(id: string) {
    return this.#lookup(this.dataSources, 'retrieveDataSource', id);
  }

  async queryDataSource(id: string) {
    this.calls.push(`queryDataSource:${normalizeId(id)}`);
    return this.rows.get(normalizeId(id)) ?? [];
  }

  async latestEditedTime(id: string) {
    this.calls.push(`latestEditedTime:${normalizeId(id)}`);
    return this.latest.get(normalizeId(id)) ?? null;
  }

  async retrievePage(id: string) {
    return this.#lookup(this.pages, 'retrievePage', id);
  }

  async listBlockChildren(id: string) {
    this.calls.push(`listBlockChildren:${normalizeId(id)}`);
    return this.children.get(normalizeId(id)) ?? [];
  }

  async listViews(id: string) {
    this.calls.push(`listViews:${normalizeId(id)}`);
    return this.views.get(normalizeId(id)) ?? [];
  }

  async queryViewPageIds(id: string) {
    this.calls.push(`queryViewPageIds:${id}`);
    return this.viewOrders.get(id) ?? [];
  }
}
