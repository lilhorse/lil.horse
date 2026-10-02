import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MediaDownloadError,
  MediaStore,
  MediaTooLargeError,
  mediaCacheKey,
} from '../../src/notion/media';
import { startServer, type TestServer } from '../helpers/http';

let server: TestServer;
let flakyCalls = 0;
let throttledCalls = 0;
let endlessFinished = false;
const files = new Map<string, { type: string; body: Buffer }>();
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'media-'));
  tempDirs.push(dir);
  return dir;
}

const solid = (width: number, height: number, background: string, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background } });

async function icon(): Promise<Buffer> {
  const png = await solid(16, 16, '#336699', 4).png().toBuffer();
  // ICONDIR, then one ICONDIRENTRY: 16×16, 1 plane, 32 bpp, PNG payload at offset 22.
  const header = Buffer.from([
    0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0,
  ]);
  header.writeUInt32LE(png.length, 14);
  return Buffer.concat([header, png]);
}

beforeAll(async () => {
  const large = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
  const small = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
  const frames = await Promise.all(
    ['#ff0000', '#00ff00', '#0000ff'].map((colour) => solid(600, 100, colour).png().toBuffer()),
  );
  const animation = () => sharp(frames, { join: { animated: true } });
  const still = await sharp(frames[0]).webp().toBuffer();
  const ico = await icon();
  const transparent = sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const noisy = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 30 },
    },
  })
    .jpeg()
    .toBuffer();
  for (const [path, type, body] of [
    ['/photo.png', 'image/png', large],
    ['/same.png', 'image/png', large],
    ['/small.png', 'image/png', small],
    ['/flaky.png', 'image/png', small],
    ['/throttled.png', 'image/png', small],
    ['/versioned.png', 'image/png', small],
    ['/doc.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test')],
    ['/anim.gif', 'image/gif', await animation().gif().toBuffer()],
    ['/anim.webp', 'image/webp', await animation().webp().toBuffer()],
    ['/still.webp', 'image/webp', still],
    ['/480.webp', 'image/webp', still],
    [
      '/rotated.jpg',
      'image/jpeg',
      await solid(800, 400, '#808080').jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    ],
    ['/clear.png', 'image/png', await transparent.png().toBuffer()],
    ['/opaque.png', 'image/png', await solid(64, 64, '#336699', 4).png().toBuffer()],
    ['/favicon.ico', 'image/x-icon', ico],
    ['/legacy.ico', 'image/vnd.microsoft.icon', ico],
    ['/fake.png', 'image/png', Buffer.from('<!doctype html><title>Sign in</title>')],
    ['/truncated.jpg', 'image/jpeg', noisy.subarray(0, Math.floor(noisy.length / 2))],
    ['/upper', 'IMAGE/PNG; charset=binary', small],
    ['/blob', 'application/octet-stream', Buffer.from('blob')],
  ] as const)
    files.set(path, { type, body });

  server = await startServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path === '/flaky.png') flakyCalls += 1;
    if (path === '/throttled.png') throttledCalls += 1;
    if (path === '/flaky.png' && flakyCalls === 1) {
      response.writeHead(500).end();
    } else if (path === '/throttled.png' && throttledCalls === 1) {
      response.writeHead(429).end();
    } else if (path === '/endless.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.write(Buffer.alloc(1024));
      const timer = setTimeout(() => {
        endlessFinished = true;
        response.end(Buffer.alloc(1024));
      }, 1000);
      response.on('close', () => clearTimeout(timer));
    } else {
      const file =
        files.get(path) ?? (/^\/(names|image)\//.test(path) ? files.get('/small.png') : undefined);
      if (file) response.writeHead(200, { 'content-type': file.type }).end(file.body);
      else response.writeHead(404).end();
    }
  });
});

afterAll(async () => {
  await server.close();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  expect(server.errors).toEqual([]);
});

const store = async () => new MediaStore({ cacheDir: await tempDir(), retryDelayMs: 1 });

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe('mediaCacheKey', () => {
  it('ignores rotating signatures on Notion-hosted files only', () => {
    const notion = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png';
    expect(mediaCacheKey(`${notion}?X-Amz-Signature=1`)).toBe(
      mediaCacheKey(`${notion}?X-Amz-Signature=2`),
    );
    expect(mediaCacheKey('https://example.com/a.png?w=1')).not.toBe(
      mediaCacheKey('https://example.com/a.png?w=2'),
    );
    expect(mediaCacheKey('https://example.com/a.png#x')).toBe(
      mediaCacheKey('https://example.com/a.png'),
    );
    expect(mediaCacheKey('https://example.com/a.png')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ignores the signature on every Notion file host', () => {
    for (const url of [
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/a.png?X-Amz-Signature=',
      'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/f/a.png?X-Amz-Signature=',
      'https://s3-us-west-2.amazonaws.com/secure.notion-static.com/f/a.png?X-Amz-Signature=',
      'https://secure.notion-static.com/f/a.png?signature=',
      'https://file.notion.so/f/f/w/f/a.png?expirationTimestamp=1&signature=',
      'https://img.notionusercontent.com/s3/prod-files-secure%2Fw%2Ff%2Fa.png/size/w=2000?exp=1&sig=',
    ])
      expect(mediaCacheKey(`${url}1`)).toBe(mediaCacheKey(`${url}2`));
  });

  it('keeps the query of other AWS and S3 URLs', () => {
    for (const url of [
      'https://abc123.execute-api.us-east-1.amazonaws.com/prod/image',
      'https://example-bucket.s3.us-west-2.amazonaws.com/a.png',
      'https://s3.us-west-2.amazonaws.com/example-bucket/a.png',
    ])
      expect(mediaCacheKey(`${url}?id=1`)).not.toBe(mediaCacheKey(`${url}?id=2`));
  });
});

describe('MediaStore', () => {
  it('produces AVIF and WebP variants no wider than the original', async () => {
    const media = await store();
    const ref = await media.ensure(`${server.url}/photo.png`, { kind: 'image' });
    expect(ref).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      width: 2000,
      height: 1000,
      fileName: 'photo.png',
    });
    expect(ref.src).toBe(`/_media/${ref.key}/photo.png`);
    expect(ref.variants.map((variant) => `${variant.width}.${variant.format}`)).toEqual([
      '480.avif',
      '480.webp',
      '960.avif',
      '960.webp',
      '1440.avif',
      '1440.webp',
    ]);
    expect(ref.dominant).toMatch(/^#[0-9a-f]{6}$/);
    for (const variant of ref.variants)
      expect(
        existsSync(join(media.directoryFor(ref.key), `${variant.width}.${variant.format}`)),
      ).toBe(true);
    expect(media.has(ref.key)).toBe(true);
  });

  it('reuses the cache across store instances without downloading again', async () => {
    const dir = await tempDir();
    await new MediaStore({ cacheDir: dir }).ensure(`${server.url}/same.png`, { kind: 'image' });
    await new MediaStore({ cacheDir: dir }).ensure(`${server.url}/same.png`, { kind: 'image' });
    expect(server.hits.get('/same.png')).toBe(1);
  });

  it('keeps small images at their own width and stores other files untouched', async () => {
    const media = await store();
    const small = await media.ensure(`${server.url}/small.png`, { kind: 'image' });
    expect(small.variants.map((variant) => variant.width)).toEqual([300, 300]);
    const pdf = await media.ensure(`${server.url}/doc.pdf`, { kind: 'file' });
    expect(pdf).toMatchObject({
      kind: 'file',
      mime: 'application/pdf',
      variants: [],
      width: null,
      fileName: 'doc.pdf',
    });
  });

  it('records the size of one frame for animations and honours EXIF rotation', async () => {
    const media = await store();
    for (const path of ['/anim.gif', '/anim.webp'])
      expect(await media.ensure(`${server.url}${path}`, { kind: 'image' })).toMatchObject({
        width: 600,
        height: 100,
      });
    expect(await media.ensure(`${server.url}/rotated.jpg`, { kind: 'image' })).toMatchObject({
      width: 400,
      height: 800,
    });
  });

  it('keeps animated WebP as the original only', async () => {
    const media = await store();
    const animated = await media.ensure(`${server.url}/anim.webp`, { kind: 'image' });
    expect(animated.variants).toEqual([]);
    const still = await media.ensure(`${server.url}/still.webp`, { kind: 'image' });
    expect(still.variants.map((variant) => `${variant.width}.${variant.format}`)).toEqual([
      '480.avif',
      '480.webp',
    ]);
  });

  it('only records a placeholder colour for opaque images', async () => {
    const media = await store();
    const clear = await media.ensure(`${server.url}/clear.png`, { kind: 'image' });
    expect(clear.dominant).toBeNull();
    const opaque = await media.ensure(`${server.url}/opaque.png`, { kind: 'image' });
    expect(opaque.dominant).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps Unicode file names', async () => {
    const media = await store();
    const named = (name: string) =>
      media.ensure(`${server.url}/names/${encodeURIComponent(name)}`, { kind: 'image' });
    const photo = await named('照片.png');
    expect(photo.fileName).toBe('照片.png');
    expect(photo.src).toBe(`/_media/${photo.key}/照片.png`);
    expect(existsSync(join(media.directoryFor(photo.key), '照片.png'))).toBe(true);
    expect((await named('截屏 2024-01-01 下午3.45.12.png')).fileName).toBe(
      '截屏-2024-01-01-下午3.45.12.png',
    );
    expect((await named('café.png')).fileName).toBe('café.png');
    const long = (await named(`${'长'.repeat(120)}.png`)).fileName;
    expect(long).toMatch(/^长+\.png$/);
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(255);
    const dots = await media.ensure(`${server.url}/blob`, { kind: 'file', fileNameHint: '..' });
    expect(dots.fileName).toBe('file');
  });

  it('names files after the URL inside a Notion image proxy path', async () => {
    const media = await store();
    const ref = await media.ensure(
      `${server.url}/image/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2Fx%2Fa.png?table=block&id=1`,
      { kind: 'image' },
    );
    expect(ref.fileName).toBe('a.png');
    for (const src of [ref.src, ...ref.variants.map((variant) => variant.src)])
      expect(src).not.toMatch(/notion-static|prod-files-secure|amazonaws/);
  });

  it('renames originals that would collide with files the entry generates', async () => {
    const media = await store();
    const webp = await media.ensure(`${server.url}/480.webp`, { kind: 'image' });
    expect(webp.fileName).toBe('file-480.webp');
    expect(webp.variants.map((variant) => `${variant.width}.${variant.format}`)).toContain(
      '480.webp',
    );
    expect(await readFile(join(media.directoryFor(webp.key), webp.fileName))).toEqual(
      files.get('/480.webp')?.body,
    );
    const meta = await media.ensure(`${server.url}/doc.pdf?as=meta`, {
      kind: 'file',
      fileNameHint: 'meta.json',
    });
    expect(meta.fileName).toBe('file-meta.json');
    expect(await readFile(join(media.directoryFor(meta.key), meta.fileName), 'utf8')).toBe(
      '%PDF-1.4 test',
    );
    expect(media.has(meta.key)).toBe(true);
  });

  it('lower-cases the content type', async () => {
    const media = await store();
    expect(await media.ensure(`${server.url}/upper`, { kind: 'image' })).toMatchObject({
      mime: 'image/png',
      fileName: 'upper.png',
    });
  });

  it('stores icons as they are', async () => {
    const media = await store();
    for (const path of ['/favicon.ico', '/legacy.ico']) {
      const ref = await media.ensure(`${server.url}${path}`, { kind: 'image' });
      expect(ref).toMatchObject({ variants: [], width: null, height: null, dominant: null });
      expect(await readFile(join(media.directoryFor(ref.key), ref.fileName))).toEqual(
        files.get(path)?.body,
      );
    }
  });

  it('names the source of an undecodable image and leaves no partial entry', async () => {
    const dir = await tempDir();
    const media = new MediaStore({ cacheDir: dir, retryDelayMs: 1 });
    for (const path of ['/fake.png', '/truncated.jpg']) {
      const error = await failureOf(
        media.ensure(`${server.url}${path}?X-Amz-Signature=secret`, { kind: 'image' }),
      );
      expect(error).toBeInstanceOf(MediaDownloadError);
      expect(error).toMatchObject({ message: `Cannot read image ${server.url}${path}` });
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('rebuilds entries written by an older cache version', async () => {
    const dir = await tempDir();
    const url = `${server.url}/versioned.png`;
    const ref = await new MediaStore({ cacheDir: dir }).ensure(url, { kind: 'image' });
    const entry = join(dir, ref.key);
    const metaPath = join(entry, 'meta.json');
    const current = JSON.parse(await readFile(metaPath, 'utf8')) as { version: number };
    for (const outdated of [ref, { ...current, version: current.version - 1 }]) {
      await writeFile(metaPath, JSON.stringify(outdated));
      await writeFile(join(entry, 'leftover.webp'), 'x');
      const media = new MediaStore({ cacheDir: dir });
      expect(media.has(ref.key)).toBe(false);
      expect(await media.ensure(url, { kind: 'image' })).toEqual(ref);
      expect(media.has(ref.key)).toBe(true);
      expect(existsSync(join(entry, 'leftover.webp'))).toBe(false);
    }
    expect(server.hits.get('/versioned.png')).toBe(3);
  });

  it('lets several stores fill one cache directory at once', async () => {
    const dir = await tempDir();
    const url = `${server.url}/small.png?shared=1`;
    const refs = await Promise.all(
      [1, 2, 3].map(() => new MediaStore({ cacheDir: dir }).ensure(url, { kind: 'image' })),
    );
    for (const ref of refs) expect(ref).toEqual(refs[0]);
    expect(await readdir(dir)).toEqual([mediaCacheKey(url)]);
    expect(new MediaStore({ cacheDir: dir }).has(mediaCacheKey(url))).toBe(true);
  });

  it('retries transient failures and deduplicates concurrent requests', async () => {
    const media = await store();
    await expect(media.ensure(`${server.url}/flaky.png`, { kind: 'image' })).resolves.toMatchObject(
      { width: 300 },
    );
    const before = server.hits.get('/small.png?dedupe=1') ?? 0;
    await Promise.all(
      [1, 2, 3].map(() => media.ensure(`${server.url}/small.png?dedupe=1`, { kind: 'image' })),
    );
    expect((server.hits.get('/small.png?dedupe=1') ?? 0) - before).toBe(1);
  });

  it('gives up on client errors at once but retries throttling', async () => {
    const media = await store();
    const error = await failureOf(media.ensure(`${server.url}/gone.png`, { kind: 'image' }));
    expect(error).toBeInstanceOf(MediaDownloadError);
    expect(error).toMatchObject({ status: 404, message: expect.stringContaining('HTTP 404') });
    expect(server.hits.get('/gone.png')).toBe(1);
    await expect(
      media.ensure(`${server.url}/throttled.png`, { kind: 'image' }),
    ).resolves.toMatchObject({ width: 300 });
    expect(server.hits.get('/throttled.png')).toBe(2);
  });

  it('fails loudly on oversized or missing files', async () => {
    const tiny = new MediaStore({ cacheDir: await tempDir(), maxBytes: 100, retryDelayMs: 1 });
    await expect(tiny.ensure(`${server.url}/photo.png`, { kind: 'image' })).rejects.toBeInstanceOf(
      MediaTooLargeError,
    );
    const media = await store();
    await expect(
      media.ensure(`${server.url}/missing.png`, { kind: 'image' }),
    ).rejects.toBeInstanceOf(MediaDownloadError);
  });

  it('stops reading a body without a length once it passes the cap', async () => {
    const tiny = new MediaStore({ cacheDir: await tempDir(), maxBytes: 100, retryDelayMs: 1 });
    await expect(
      tiny.ensure(`${server.url}/endless.png`, { kind: 'image' }),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
    expect(endlessFinished).toBe(false);
  });
});
