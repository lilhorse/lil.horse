import { describe, expect, it } from 'vitest';
import { startServer } from '../helpers/http';

describe('startServer', () => {
  it('answers 500 and records the error when the handler throws', async () => {
    const server = await startServer((request) => {
      if (request.url === '/sync') throw new Error('sync failure');
      return Promise.reject(new Error('async failure'));
    });
    try {
      for (const path of ['/sync', '/async']) {
        const response = await fetch(`${server.url}${path}`, { signal: AbortSignal.timeout(2000) });
        expect(response.status).toBe(500);
      }
      expect(server.errors).toEqual([new Error('sync failure'), new Error('async failure')]);
    } finally {
      await server.close();
    }
  });
});
