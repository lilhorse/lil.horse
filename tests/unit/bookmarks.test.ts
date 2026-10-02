import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookmarkFetcher, parseHead } from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { startServer, type TestServer } from '../helpers/http';

const HTML = `<!doctype html><html><head>
<meta content="An &amp; B" property="og:title">
<meta name="description" content='Plain &quot;description&quot;'>
<meta property="og:site_name" content="Example">
<meta property="og:image" content="/cover.png">
<link rel="shortcut icon" href="/favicon.png">
<title>Fallback title</title>
</head><body></body></html>`;

let server: TestServer;
let failing = false;

beforeAll(async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } })
    .png()
    .toBuffer();
  server = await startServer((request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (failing) {
      response.statusCode = 500;
      response.end();
    } else if (path === '/article') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(HTML);
    } else if (path === '/broken-image') {
      response.setHeader('content-type', 'text/html');
      response.end('<meta property="og:image" content="/missing.png"><title>Broken</title>');
    } else if (path === '/cover.png' || path === '/favicon.png') {
      response.setHeader('content-type', 'image/png');
      response.end(png);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
});

afterAll(() => server.close());

async function fetcher(now: () => number, warnings: string[] = [], cacheDir?: string) {
  const dir = cacheDir ?? (await mkdtemp(join(tmpdir(), 'bookmarks-')));
  const media = new MediaStore({ cacheDir: join(dir, 'media'), retries: 0 });
  return {
    dir,
    fetcher: new BookmarkFetcher({
      cacheDir: dir,
      media,
      now,
      warn: (message) => warnings.push(message),
    }),
  };
}

describe('parseHead', () => {
  it('prefers Open Graph values, decodes entities and resolves relative URLs', () => {
    expect(parseHead(HTML, 'https://example.com/post/1')).toEqual({
      title: 'An & B',
      description: 'Plain "description"',
      siteName: 'Example',
      image: 'https://example.com/cover.png',
      icon: 'https://example.com/favicon.png',
    });
  });
});

describe('BookmarkFetcher', () => {
  it('fetches, downloads images and caches until the TTL expires', async () => {
    let clock = 0;
    const { dir, fetcher: first } = await fetcher(() => clock);
    const meta = await first.get(`${server.url}/article`);
    expect(meta?.title).toBe('An & B');
    expect(meta?.image?.width).toBe(64);

    const { fetcher: second } = await fetcher(() => clock, [], dir);
    await second.get(`${server.url}/article`);
    expect(server.hits.get('/article')).toBe(1);

    clock = 8 * 24 * 60 * 60 * 1000;
    await second.get(`${server.url}/article`);
    expect(server.hits.get('/article')).toBe(2);
  });

  it('degrades instead of failing', async () => {
    const warnings: string[] = [];
    const { fetcher: subject } = await fetcher(() => 0, warnings);
    const broken = await subject.get(`${server.url}/broken-image`);
    expect(broken).toMatchObject({ title: 'Broken', image: null });

    failing = true;
    expect(await subject.get(`${server.url}/never-cached`)).toBeNull();
    expect(warnings.some((warning) => warning.includes('/never-cached'))).toBe(true);
    failing = false;
  });

  it('serves stale metadata when a refresh fails', async () => {
    let clock = 0;
    const { fetcher: subject } = await fetcher(() => clock);
    await subject.get(`${server.url}/article?stale=1`);
    clock = 30 * 24 * 60 * 60 * 1000;
    failing = true;
    expect((await subject.get(`${server.url}/article?stale=1`))?.title).toBe('An & B');
    failing = false;
  });
});
