import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCloudflareFiles } from '../../integrations/cloudflare';
import { scriptHash } from '../../src/lib/csp';
import { tempDir } from '../helpers/temp-dir';

describe('writeCloudflareFiles', () => {
  it('writes the redirects from the manifest and a policy hashing every inline script', async () => {
    const dist = await tempDir('cf-');
    await writeFile(join(dist, 'index.html'), '<html><body><script>init()</script></body></html>');
    await writeFile(join(dist, '404.html'), '<html><body><script>path()</script></body></html>');
    const result = await writeCloudflareFiles(dist, {
      posts: [{ id: 'b'.repeat(32), slug: 'douban' }],
      pages: [],
    });
    expect(result).toEqual({ redirects: 5, hashes: 2 });
    const redirects = await readFile(join(dist, '_redirects'), 'utf8');
    expect(redirects).toBe(
      `/douban /blog/douban 301\n/${'b'.repeat(32)} /blog/douban 301\n/douban-${'b'.repeat(32)} /blog/douban 301\n/feed /feed.xml 301\n/*/ /:splat 301\n`,
    );
    const headers = await readFile(join(dist, '_headers'), 'utf8');
    expect(headers).toContain(`'${scriptHash('init()')}'`);
    expect(headers).toContain(`'${scriptHash('path()')}'`);
  });
});
