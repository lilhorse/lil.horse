import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDistFile, serveDist } from '../../scripts/serve-dist';
import { tempDir } from '../helpers/temp-dir';

async function dist(): Promise<string> {
  const root = await tempDir('serve-');
  for (const path of [
    'index.html',
    'blog.html',
    'blog/douban.html',
    '404.html',
    'blog/tags/中文.html',
    '_media/k/480.webp',
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path);
  }
  return root;
}

describe('resolveDistFile', () => {
  it('serves pages without .html and assets as they are', async () => {
    const root = await dist();
    expect(resolveDistFile(root, '/')).toEqual({ file: join(root, 'index.html'), status: 200 });
    expect(resolveDistFile(root, '/blog')).toEqual({ file: join(root, 'blog.html'), status: 200 });
    expect(resolveDistFile(root, '/blog/douban?x=1')).toEqual({
      file: join(root, 'blog/douban.html'),
      status: 200,
    });
    expect(resolveDistFile(root, '/_media/k/480.webp').status).toBe(200);
    expect(resolveDistFile(root, '/blog/tags/%E4%B8%AD%E6%96%87')).toEqual({
      file: join(root, 'blog/tags/中文.html'),
      status: 200,
    });
  });

  it('answers 404 with the 404 page for missing, escaping or malformed paths', async () => {
    const root = await dist();
    const missing = { file: join(root, '404.html'), status: 404 };
    expect(resolveDistFile(root, '/nope')).toEqual(missing);
    expect(resolveDistFile(root, '/blog/')).toEqual(missing);
    expect(resolveDistFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toEqual(missing);
    expect(resolveDistFile(root, '/%E0%A4%A')).toEqual(missing);
  });
});

describe('serveDist', () => {
  it('keeps serving while dist/ is empty during a rebuild', async () => {
    const server = serveDist(await tempDir('serve-empty-'), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      for (const path of ['/', '/blog']) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(response.status).toBe(404);
        await response.text();
      }
    } finally {
      server.close();
    }
  });

  it('applies _redirects and _headers the way Cloudflare does and hides both files', async () => {
    const root = await dist();
    await writeFile(join(root, '_redirects'), '/helloworld /blog/douban 301\n/*/ /:splat 301\n');
    await writeFile(
      join(root, '_headers'),
      [
        '/*',
        "  Content-Security-Policy: default-src 'self'",
        '  X-Content-Type-Options: nosniff',
        '/_media/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '  ! Content-Security-Policy',
        '  Content-Security-Policy: sandbox',
        '',
      ].join('\n'),
    );
    const server = serveDist(root, 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const request = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
      await response.text();
      return response;
    };
    try {
      const moved = await request('/helloworld?x=1');
      expect(moved.status).toBe(301);
      expect(moved.headers.get('location')).toBe('/blog/douban?x=1');
      expect(moved.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await request('/blog/')).headers.get('location')).toBe('/blog');
      const page = await request('/blog/douban');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe("default-src 'self'");
      expect(page.headers.get('cache-control')).toBeNull();
      const media = await request('/_media/k/480.webp');
      expect(media.headers.get('content-security-policy')).toBe('sandbox');
      expect(media.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect((await request('/_headers')).status).toBe(404);
      expect((await request('/_redirects')).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('answers a malformed request target with the 404 page and keeps serving', async () => {
    const server = serveDist(await dist(), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const status = await new Promise<number | undefined>((done, fail) => {
        get({ host: '127.0.0.1', port, path: '//[' }, (response) => {
          response.resume();
          done(response.statusCode);
        }).on('error', fail);
      });
      expect(status).toBe(404);
      const after = await fetch(`http://127.0.0.1:${port}/blog`);
      expect(after.status).toBe(200);
      await after.text();
    } finally {
      server.close();
    }
  });
});
