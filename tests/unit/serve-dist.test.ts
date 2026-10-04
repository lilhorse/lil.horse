import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { get, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
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
    'favicon.ico',
    'fonts/k.ttf',
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

  it('never serves _headers or _redirects, however the path spells them', async () => {
    const root = await dist();
    await writeFile(join(root, '_headers'), '/*\n');
    await writeFile(join(root, '_redirects'), '/a /b 301\n');
    const missing = { file: join(root, '404.html'), status: 404 };
    for (const path of [
      '/_headers',
      '/_redirects',
      '/%2F_headers',
      '/.%2F_headers',
      '/blog%2F..%2F_redirects',
      '/_HEADERS',
    ])
      expect(resolveDistFile(root, path), path).toEqual(missing);
  });
});

/** Sends the target as written; fetch() would normalize it first. */
function rawGet(port: number, path: string) {
  return new Promise<{ status?: number; location?: string }>((done, fail) => {
    get({ host: '127.0.0.1', port, path }, (response) => {
      response.resume();
      done({ status: response.statusCode, location: response.headers.location });
    }).on('error', fail);
  });
}

describe('serveDist', () => {
  it('keeps serving while dist/ is empty during a rebuild', async () => {
    const server = serveDist(await tempDir('serve-empty-'), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      for (const path of ['/', '/blog']) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          headers: { 'accept-encoding': 'gzip' },
        });
        expect(response.status).toBe(404);
        expect(response.headers.get('content-encoding')).toBeNull();
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
      expect(moved.headers.get('cache-control')).toBeNull();
      expect((await request('/blog/')).headers.get('location')).toBe('/blog');
      const page = await request('/blog/douban');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe("default-src 'self'");
      expect(page.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      const missing = await request('/nope');
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      const media = await request('/_media/k/480.webp');
      expect(media.headers.get('content-security-policy')).toBe('sandbox');
      expect(media.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect((await request('/_headers')).status).toBe(404);
      expect((await request('/_redirects')).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('keeps redirects on the site and sends odd spellings to the canonical path', async () => {
    const root = await dist();
    await writeFile(join(root, '_redirects'), '/*/ /:splat 301\n');
    const server = serveDist(root, 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      for (const [path, status, location] of [
        ['//evil.com/', 301, '/evil.com'],
        ['//evil.com/x/', 301, '/evil.com/x'],
        ['http://localhost//evil.com/', 301, '/evil.com'],
        ['/%5Fmedia/k/480.webp', 307, '/_media/k/480.webp'],
        ['/blog/tags/%e4%b8%ad%e6%96%87', 307, '/blog/tags/%E4%B8%AD%E6%96%87'],
        ['//blog?x=1', 307, '/blog?x=1'],
        ['/%2F_headers', 307, '/_headers'],
        ['/blog/tags/%E4%B8%AD%E6%96%87', 200, undefined],
      ] as const)
        expect(await rawGet(port, path), path).toEqual({ status, location });
    } finally {
      server.close();
    }
  });

  it('sends a page asked for by its .html file to its path with a 307', async () => {
    const server = serveDist(await dist(), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      for (const [path, status, location] of [
        ['/blog.html', 307, '/blog'],
        ['/blog/douban.html?x=1', 307, '/blog/douban?x=1'],
        ['/index.html', 307, '/'],
        ['/blog/tags/%E4%B8%AD%E6%96%87.html', 307, '/blog/tags/%E4%B8%AD%E6%96%87'],
        ['/nope.html', 404, undefined],
        ['/blog', 200, undefined],
      ] as const)
        expect(await rawGet(port, path), path).toEqual({ status, location });
    } finally {
      server.close();
    }
  });

  it('answers a malformed request target with the 404 page and keeps serving', async () => {
    const server = serveDist(await dist(), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      expect((await rawGet(port, 'http://[/')).status).toBe(404);
      const after = await fetch(`http://127.0.0.1:${port}/blog`);
      expect(after.status).toBe(200);
      await after.text();
    } finally {
      server.close();
    }
  });
});

/** Reads the body as sent, still compressed; fetch() would decode it. */
function download(port: number, path: string, encoding?: string) {
  return new Promise<{ headers: IncomingHttpHeaders; body: Buffer }>((done, fail) => {
    const headers = encoding ? { 'accept-encoding': encoding } : {};
    get({ host: '127.0.0.1', port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', fail);
  });
}

/** Gives the start of a page, then fails the way a disk read can. */
function failsHalfway(): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (sent) this.destroy(new Error('EIO: i/o error, read'));
      else {
        sent = true;
        this.push('<p>The first half');
      }
    },
  });
}

describe('serveDist compression', () => {
  it('gzips the types Cloudflare compresses for clients that accept it, and no others', async () => {
    const server = serveDist(await dist(), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const compressed = await download(port, '/blog/douban', 'gzip, deflate, br');
      expect(compressed.headers['content-encoding']).toBe('gzip');
      expect(compressed.headers.vary).toBe('accept-encoding');
      expect(gunzipSync(compressed.body).toString()).toBe('blog/douban.html');
      const plain = await download(port, '/blog/douban');
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.body.toString()).toBe('blog/douban.html');
      for (const path of ['/favicon.ico', '/fonts/k.ttf']) {
        const file = await download(port, path, 'gzip');
        expect(file.headers['content-encoding'], path).toBe('gzip');
        expect(gunzipSync(file.body).toString(), path).toBe(path.slice(1));
      }
      const image = await download(port, '/_media/k/480.webp', 'gzip');
      expect(image.headers['content-encoding']).toBeUndefined();
      expect(image.headers.vary).toBeUndefined();
      expect(image.body.toString()).toBe('_media/k/480.webp');
    } finally {
      server.close();
    }
  });

  it('reads q-values, so a client that sends gzip;q=0 gets the file uncompressed', async () => {
    const server = serveDist(await dist(), 0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      for (const [encoding, expected] of [
        ['gzip;q=0', undefined],
        ['br, gzip; q=0.000', undefined],
        ['GZip;Q=0.5', 'gzip'],
        ['deflate, gzip;q=1.0', 'gzip'],
      ] as const) {
        const { headers } = await download(port, '/blog/douban', encoding);
        expect(headers['content-encoding'], encoding).toBe(expected);
      }
    } finally {
      server.close();
    }
  });

  it('ends a gzip response cleanly when the file fails halfway through, and keeps serving', async () => {
    const server = serveDist(await dist(), 0, (file) =>
      file.endsWith('douban.html') ? failsHalfway() : createReadStream(file),
    );
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const cut = await download(port, '/blog/douban', 'gzip');
      expect(cut.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(cut.body).toString()).toBe('<p>The first half');
      expect((await download(port, '/blog/douban')).body.toString()).toBe('<p>The first half');
      expect((await download(port, '/blog', 'gzip')).headers['content-encoding']).toBe('gzip');
    } finally {
      server.close();
    }
  });
});
