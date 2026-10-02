import { describe, expect, it } from 'vitest';
import { createNotionApi, isNotFoundError, NOTION_VERSION } from '../../src/notion/api';
import { RateLimiter } from '../../src/notion/rate-limit';
import { block, page } from '../helpers/notion-factory';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createNotionApi', () => {
  it('pins the Notion-Version header, follows cursors and drops trashed blocks', async () => {
    const requests: { url: string; version: string | null }[] = [];
    const responses = [
      {
        object: 'list',
        type: 'block',
        block: {},
        results: [
          block('paragraph', {}, { id: 'a' }),
          block('paragraph', {}, { id: 'b', inTrash: true }),
        ],
        has_more: true,
        next_cursor: 'cursor-2',
      },
      {
        object: 'list',
        type: 'block',
        block: {},
        results: [block('paragraph', {}, { id: 'c' })],
        has_more: false,
        next_cursor: null,
      },
    ];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        version: new Headers(init?.headers).get('notion-version'),
      });
      return jsonResponse(responses.shift());
    }) as typeof fetch;

    const api = createNotionApi({
      token: 'secret',
      fetch: fakeFetch,
      limiter: new RateLimiter({ concurrency: 3, minIntervalMs: 0 }),
    });
    const blocks = await api.listBlockChildren('71d7802a0abf4857a535dfd861d8491e');

    expect(blocks.map((item) => item.id)).toEqual(['a', 'c']);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.version === NOTION_VERSION)).toBe(true);
    expect(requests[1]?.url).toContain('start_cursor=cursor-2');
  });

  it('recognises object_not_found errors', async () => {
    const fakeFetch = (async () =>
      jsonResponse(
        { object: 'error', status: 404, code: 'object_not_found', message: 'nope' },
        404,
      )) as typeof fetch;
    const api = createNotionApi({
      token: 'secret',
      fetch: fakeFetch,
      limiter: new RateLimiter({ concurrency: 1, minIntervalMs: 0 }),
    });
    const error = await api
      .retrieveDatabase('71d7802a0abf4857a535dfd861d8491e')
      .catch((caught: unknown) => caught);
    expect(isNotFoundError(error)).toBe(true);
  });

  it('retries 5xx on POST queries and gateway errors on GET', async () => {
    const responses = [
      jsonResponse(
        { object: 'error', status: 503, code: 'service_unavailable', message: 'busy' },
        503,
      ),
      jsonResponse({
        object: 'list',
        type: 'page_or_data_source',
        page_or_data_source: {},
        results: [page({}, { id: 'row' })],
        has_more: false,
        next_cursor: null,
      }),
      new Response('<html>bad gateway</html>', { status: 502 }),
      jsonResponse({
        object: 'list',
        type: 'block',
        block: {},
        results: [block('paragraph', {}, { id: 'a' })],
        has_more: false,
        next_cursor: null,
      }),
    ];
    const methods: string[] = [];
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return responses.shift() as Response;
    }) as typeof fetch;
    const api = createNotionApi({
      token: 'secret',
      fetch: fakeFetch,
      limiter: new RateLimiter({ concurrency: 1, minIntervalMs: 0 }),
      retryDelayMs: 0,
    });

    expect(
      (await api.queryDataSource('71d7802a0abf4857a535dfd861d8491e')).map((row) => row.id),
    ).toEqual(['row']);
    expect(
      (await api.listBlockChildren('71d7802a0abf4857a535dfd861d8491e')).map((item) => item.id),
    ).toEqual(['a']);
    expect(methods).toEqual(['POST', 'POST', 'GET', 'GET']);
  });

  it('gives up after five retries and never retries client errors', async () => {
    let calls = 0;
    const failWith = (status: number, code: string) =>
      (async () => {
        calls += 1;
        return jsonResponse({ object: 'error', status, code, message: code }, status);
      }) as typeof fetch;
    const limiter = new RateLimiter({ concurrency: 1, minIntervalMs: 0 });

    const down = createNotionApi({
      token: 'secret',
      fetch: failWith(500, 'internal_server_error'),
      limiter,
      retryDelayMs: 0,
    });
    await expect(down.retrievePage('71d7802a0abf4857a535dfd861d8491e')).rejects.toThrow();
    expect(calls).toBe(6);

    calls = 0;
    const invalid = createNotionApi({
      token: 'secret',
      fetch: failWith(400, 'validation_error'),
      limiter,
      retryDelayMs: 0,
    });
    await expect(invalid.retrievePage('71d7802a0abf4857a535dfd861d8491e')).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
