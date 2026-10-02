import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BookmarkFetcher,
  parseHead,
  type BookmarkFetcherOptions,
} from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { startServer, type TestServer } from '../helpers/http';
import { tempDir } from '../helpers/temp-dir';

const HTML = `<!doctype html><html><head>
<meta content="An &amp; B" property="og:title">
<meta name="description" content='Plain &quot;description&quot;'>
<meta property="og:site_name" content="Example">
<meta property="og:image" content="/cover.png">
<link rel="shortcut icon" href="/favicon.png">
<title>Fallback title</title>
</head><body></body></html>`;

const BASE = 'https://example.com/post/1';
const GBK_TITLE = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xea, 0xcc, 0xe2]);
const bytes = (...parts: (string | Buffer)[]) =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part) : part)));

const CHARSET_PAGES = [
  {
    name: 'GBK declared in the header',
    type: 'text/html; charset=gbk',
    body: bytes('<title>', GBK_TITLE, '</title>'),
  },
  {
    name: 'GB2312 declared by http-equiv',
    type: 'text/html',
    body: bytes(
      '<meta http-equiv="Content-Type" content="text/html; charset=gb2312"><title>',
      GBK_TITLE,
      '</title>',
    ),
  },
  {
    name: 'GBK declared by meta charset',
    type: 'text/html',
    body: bytes('<meta charset="gbk"><title>', GBK_TITLE, '</title>'),
  },
  {
    name: 'UTF-8 with no declared charset',
    type: 'text/html',
    body: bytes('<title>中文标题</title>'),
  },
  {
    name: 'UTF-8 with a BOM and a wrong header charset',
    type: 'text/html; charset=gbk',
    body: bytes(Buffer.from([0xef, 0xbb, 0xbf]), '<title>中文标题</title>'),
  },
  {
    name: 'UTF-8 with an unknown header charset',
    type: 'text/html; charset=bogus',
    body: bytes('<title>中文标题</title>'),
  },
  {
    name: 'GBK declared by meta charset under an unknown header charset',
    type: 'text/html; charset=bogus',
    body: bytes('<meta charset="gbk"><title>', GBK_TITLE, '</title>'),
  },
  {
    name: 'UTF-8 that a meta tag calls UTF-16',
    type: 'text/html',
    body: bytes('<meta charset="utf-16"><title>中文标题</title>'),
  },
];

const CP1252_TITLE = Buffer.from('Caf\xe9 \x93q\x94', 'latin1');
const CP1252_PAGES = [
  {
    name: 'windows-1252 declared in the header',
    type: 'text/html; charset=windows-1252',
    body: bytes('<title>', CP1252_TITLE, '</title>'),
  },
  {
    name: 'ISO-8859-1 declared by meta charset',
    type: 'text/html',
    body: bytes('<meta charset="iso-8859-1"><title>', CP1252_TITLE, '</title>'),
  },
];

const PAGES = new Map<string, { type: string; body: string | Buffer }>([
  ['/article', { type: 'text/html; charset=utf-8', body: HTML }],
  ['/plain', { type: 'text/html', body: '<title>Plain</title>' }],
  [
    '/broken-image',
    {
      type: 'text/html',
      body: '<meta property="og:image" content="/missing.png?token=secret"><link rel="icon" href="/not-an-image.png?token=secret"><link rel="apple-touch-icon" href="/missing-icon.png"><link rel="shortcut icon" href="/missing-icon.png"><title>Broken</title>',
    },
  ],
  [
    '/icons',
    {
      type: 'text/html',
      body: '<link rel="icon" href="/not-an-image.png"><link rel="icon" href="/favicon.png"><title>Icons</title>',
    },
  ],
  [
    '/keywords',
    {
      type: 'text/html',
      body: '<meta name="keywords" content="x &#x110000; y"><title>Keywords</title>',
    },
  ],
  [
    '/mislabelled',
    {
      type: 'text/html; charset=utf-8',
      body: bytes(
        '<title>',
        GBK_TITLE,
        '</title><meta name="description" content="',
        GBK_TITLE,
        '"><meta property="og:site_name" content="Readable">',
      ),
    },
  ],
  ['/not-an-image.png', { type: 'image/png', body: 'not an image' }],
  ...CHARSET_PAGES.map(({ type, body }, index) => [`/charset/${index}`, { type, body }] as const),
  ...CP1252_PAGES.map(({ type, body }, index) => [`/cp1252/${index}`, { type, body }] as const),
]);

const CACHED = { title: 'Cached', description: null, siteName: null, image: null, icon: null };
const MALFORMED_CACHE: Record<string, unknown> = {
  'no meta': { fetchedAt: 0 },
  'meta without image or icon': {
    fetchedAt: 0,
    meta: { title: 'Cached', description: null, siteName: null },
  },
  'an image without a key': { fetchedAt: 0, meta: { ...CACHED, image: { src: '/_media/a.png' } } },
  'an icon that is not an object': { fetchedAt: 0, meta: { ...CACHED, icon: '/_media/icon.png' } },
  'a fetchedAt that is not a number': { fetchedAt: '0', meta: CACHED },
  'a title that is not text': { fetchedAt: 0, meta: { ...CACHED, title: 5 } },
  'no object at all': 5,
};

let server: TestServer;
let failing = false;

beforeAll(async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } })
    .png()
    .toBuffer();
  server = await startServer((request, response) => {
    const path = (request.url ?? '').split('?')[0];
    const page = PAGES.get(path);
    if (failing) {
      response.statusCode = 500;
      response.end();
    } else if (page) {
      response.setHeader('content-type', page.type);
      response.end(page.body);
    } else if (path === '/cover.png' || path === '/favicon.png') {
      response.setHeader('content-type', 'image/png');
      response.end(png);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
});

afterAll(() => server?.close());

async function setup(options: Partial<BookmarkFetcherOptions> = {}) {
  const dir = options.cacheDir ?? (await tempDir('bookmarks-'));
  const warnings: string[] = [];
  const media = new MediaStore({ cacheDir: join(dir, 'media'), retries: 0 });
  const fetcher = new BookmarkFetcher({
    cacheDir: dir,
    media,
    now: () => 0,
    warn: (message) => warnings.push(message),
    ...options,
  });
  return { dir, media, warnings, fetcher };
}

describe('parseHead', () => {
  it('prefers Open Graph values, decodes entities and resolves relative URLs', () => {
    expect(parseHead(HTML, BASE)).toEqual({
      title: 'An & B',
      description: 'Plain "description"',
      siteName: 'Example',
      image: 'https://example.com/cover.png',
      icon: 'https://example.com/favicon.png',
    });
  });

  it('decodes common named entities', () => {
    const html =
      '<title>A &mdash; B &ndash; C &hellip; &lsquo;s&rsquo; &ldquo;q&rdquo; &laquo;r&raquo; &middot; &copy; &reg; &trade;&nbsp;x</title>';
    expect(parseHead(html, BASE).title).toBe('A — B – C … ‘s’ “q” «r» · © ® ™\u00a0x');
  });

  it('leaves names that only exist on Object.prototype literal', () => {
    expect(parseHead('<title>Q &constructor; R</title>', BASE).title).toBe('Q &constructor; R');
  });

  it('replaces out-of-range numeric entities instead of throwing', () => {
    expect(parseHead('<title>a&#x110000;b&#0;c&#65;</title>', BASE).title).toBe('a\ufffdb\ufffdcA');
  });

  it('keeps only http and https image and icon URLs', () => {
    const html =
      '<meta property="og:image" content="file:///etc/passwd"><link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAAA"><link rel="icon" href="/icon.png">';
    expect(parseHead(html, BASE)).toMatchObject({
      image: null,
      icon: 'https://example.com/icon.png',
    });
  });

  it('parses a very long attribute name in linear time', () => {
    const started = performance.now();
    parseHead(`<meta ${'a'.repeat(160_000)}>`, BASE);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('BookmarkFetcher', () => {
  it('fetches, downloads images and caches until the TTL expires', async () => {
    let clock = 0;
    const { dir, fetcher: first } = await setup({ now: () => clock });
    const meta = await first.get(`${server.url}/article`);
    expect(meta?.title).toBe('An & B');
    expect(meta?.image?.width).toBe(64);
    expect(meta?.icon).toMatchObject({ fileName: 'favicon.png', width: 64 });

    const { fetcher: second } = await setup({ now: () => clock, cacheDir: dir });
    await second.get(`${server.url}/article`);
    expect(server.hits.get('/article')).toBe(1);

    clock = 8 * 24 * 60 * 60 * 1000;
    await second.get(`${server.url}/article`);
    expect(server.hits.get('/article')).toBe(2);
  });

  it('degrades instead of failing', async () => {
    const { fetcher: subject, warnings } = await setup();
    const broken = await subject.get(`${server.url}/broken-image`);
    expect(broken).toMatchObject({ title: 'Broken', image: null });

    failing = true;
    try {
      expect(await subject.get(`${server.url}/never-cached`)).toBeNull();
    } finally {
      failing = false;
    }
    expect(warnings.some((warning) => warning.includes('/never-cached'))).toBe(true);
  });

  it('serves stale metadata when a refresh fails', async () => {
    let clock = 0;
    const { fetcher: subject } = await setup({ now: () => clock });
    await subject.get(`${server.url}/article?stale=1`);
    clock = 30 * 24 * 60 * 60 * 1000;
    failing = true;
    try {
      expect((await subject.get(`${server.url}/article?stale=1`))?.title).toBe('An & B');
    } finally {
      failing = false;
    }
  });

  for (const [index, [shape, entry]] of Object.entries(MALFORMED_CACHE).entries())
    it(`treats a cache entry with ${shape} as a miss`, async () => {
      const { dir, fetcher: subject } = await setup();
      const path = `/plain?malformed=${index}`;
      await subject.get(`${server.url}${path}`);
      const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
      expect(files).toHaveLength(1);
      const corrupt = () => writeFile(join(dir, files[0]), JSON.stringify(entry));

      await corrupt();
      await expect(subject.get(`${server.url}${path}`)).resolves.toMatchObject({ title: 'Plain' });
      expect(server.hits.get(path)).toBe(2);

      await corrupt();
      failing = true;
      try {
        await expect(subject.get(`${server.url}${path}`)).resolves.toBeNull();
      } finally {
        failing = false;
      }
    });

  it('shares one fetch between concurrent calls for the same URL', async () => {
    const { fetcher: subject } = await setup();
    const url = `${server.url}/article?concurrent=1`;
    const results = await Promise.all([subject.get(url), subject.get(url)]);
    expect(results.map((meta) => meta?.title)).toEqual(['An & B', 'An & B']);
    expect(server.hits.get('/article?concurrent=1')).toBe(1);
  });

  it('lets fetchers that share a cache directory write at the same time', async () => {
    const { dir, media, warnings, fetcher: first } = await setup();
    const second = new BookmarkFetcher({
      cacheDir: dir,
      media,
      now: () => 0,
      warn: (message) => warnings.push(message),
    });
    const url = `${server.url}/article?shared=1`;
    const results = await Promise.all([first.get(url), second.get(url)]);
    expect(results.map((meta) => meta?.title)).toEqual(['An & B', 'An & B']);
    expect(warnings).toEqual([]);
  });

  for (const [index, { name }] of CHARSET_PAGES.entries())
    it(`decodes ${name}`, async () => {
      const { fetcher: subject } = await setup();
      expect((await subject.get(`${server.url}/charset/${index}`))?.title).toBe('中文标题');
    });

  for (const [index, { name }] of CP1252_PAGES.entries())
    it(`decodes curly quotes from ${name}`, async () => {
      const { fetcher: subject } = await setup();
      expect((await subject.get(`${server.url}/cp1252/${index}`))?.title).toBe('Café “q”');
    });

  it('drops text that is still garbled after decoding', async () => {
    const { fetcher: subject } = await setup();
    expect(await subject.get(`${server.url}/mislabelled`)).toMatchObject({
      title: null,
      description: null,
      siteName: 'Readable',
    });
  });

  it('keeps the bookmark when a meta tag has an out-of-range numeric entity', async () => {
    const { fetcher: subject } = await setup();
    expect((await subject.get(`${server.url}/keywords`))?.title).toBe('Keywords');
  });

  it('falls back to the next icon when one cannot be decoded', async () => {
    const { fetcher: subject, warnings } = await setup();
    const meta = await subject.get(`${server.url}/icons`);
    expect(meta?.icon?.fileName).toBe('favicon.png');
    expect(server.hits.get('/not-an-image.png')).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('scans link tags once per fetched page', async () => {
    const { fetcher: subject } = await setup();
    const match = vi.spyOn(String.prototype, 'match');
    try {
      await subject.get(`${server.url}/article?scans=1`);
      const linkScans = match.mock.calls.filter(
        ([pattern]) => pattern instanceof RegExp && pattern.source.startsWith('<link'),
      );
      expect(linkScans.length).toBe(1);
    } finally {
      match.mockRestore();
    }
  });

  it('warns about images it cannot use, without their query strings', async () => {
    const { fetcher: subject, warnings } = await setup();
    const iconHits = server.hits.get('/missing-icon.png') ?? 0;
    expect(await subject.get(`${server.url}/broken-image`)).toMatchObject({
      image: null,
      icon: null,
    });
    expect(server.hits.get('/missing-icon.png')).toBe(iconHits + 1);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(`${server.url}/missing.png`);
    expect(warnings[1]).toContain(`${server.url}/not-an-image.png`);
    expect(warnings[1]).toContain(`${server.url}/missing-icon.png`);
    expect(warnings.join('\n')).not.toContain('secret');
  });

  it('returns fetched metadata even when it cannot be cached', async () => {
    const blocked = join(await tempDir('bookmarks-'), 'blocked');
    await writeFile(blocked, '');
    const { fetcher: subject, warnings } = await setup({ cacheDir: blocked });
    expect((await subject.get(`${server.url}/plain?uncached=1`))?.title).toBe('Plain');
    expect(warnings.join('\n')).toMatch(/could not cache/i);
  });

  it('keeps the defaults for options passed as undefined', async () => {
    const dir = await tempDir('bookmarks-');
    const subject = new BookmarkFetcher({
      cacheDir: dir,
      media: new MediaStore({ cacheDir: join(dir, 'media'), retries: 0 }),
      fetch: undefined,
      ttlMs: undefined,
      now: undefined,
      timeoutMs: undefined,
      warn: undefined,
    });
    const url = `${server.url}/plain?defaults=1`;
    expect((await subject.get(url))?.title).toBe('Plain');
    await subject.get(url);
    expect(server.hits.get('/plain?defaults=1')).toBe(1);
    await expect(subject.get(`${server.url}/missing-page`)).resolves.toBeNull();
  });

  it('refetches when cached images are gone from the media store', async () => {
    const { dir, media, fetcher: subject } = await setup();
    const url = `${server.url}/article?media=1`;
    await subject.get(url);
    await rm(join(dir, 'media'), { recursive: true, force: true });

    const meta = await subject.get(url);
    expect(server.hits.get('/article?media=1')).toBe(2);
    expect(meta?.image && media.has(meta.image.key)).toBe(true);

    await rm(join(dir, 'media'), { recursive: true, force: true });
    failing = true;
    try {
      expect(await subject.get(url)).toMatchObject({ title: 'An & B', image: null, icon: null });
    } finally {
      failing = false;
    }
  });

  it('reports the cause of a network failure', async () => {
    const closed = await startServer(() => undefined);
    await closed.close();
    const { fetcher: subject, warnings } = await setup();
    expect(await subject.get(`${closed.url}/page`)).toBeNull();
    expect(warnings.join('\n')).toMatch(/fetch failed.*ECONNREFUSED/);
  });

  it('names the error code when every address of a host refuses the connection', async () => {
    const closed = await startServer(() => undefined);
    await closed.close();
    const { fetcher: subject, warnings } = await setup();
    expect(await subject.get(`${closed.url.replace('127.0.0.1', 'localhost')}/page`)).toBeNull();
    expect(warnings.join('\n')).toMatch(/fetch failed \(.*ECONNREFUSED/);
  });

  it('only fetches http and https URLs', async () => {
    const requested: string[] = [];
    const { fetcher: subject, warnings } = await setup({
      fetch: async (input) => {
        requested.push(String(input));
        return new Response('<title>Fetched</title>', { headers: { 'content-type': 'text/html' } });
      },
    });
    for (const url of [
      'file:///etc/hosts',
      'data:text/html,<title>x</title>',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(await subject.get(url)).toBeNull();
    expect(requested).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it('reports to the warn passed with the call instead of the constructor one', async () => {
    const { fetcher: subject, warnings } = await setup();
    const own: string[] = [];
    await subject.get(`${server.url}/broken-image`, (message) => own.push(message));
    await subject.get('not a url', (message) => own.push(message));
    expect(own).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it('stops reading a page once it passes 512 KiB', async () => {
    const encoder = new TextEncoder();
    const parts = [
      '<title>Capped</title>',
      ...Array.from({ length: 12 }, () => '中'.repeat(16_384)),
      '<meta name="description" content="Past the cap">',
      ...Array.from({ length: 64 }, () => ' '.repeat(65_536)),
    ];
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts.shift();
        if (part === undefined) {
          controller.close();
          return;
        }
        const chunk = encoder.encode(part);
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetcher: subject } = await setup({
      fetch: async () =>
        new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });
    expect(await subject.get('https://example.com/huge')).toMatchObject({
      title: 'Capped',
      description: null,
    });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(1024 * 1024);
  });
});
