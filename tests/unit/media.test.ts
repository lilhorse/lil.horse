import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
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
  server = await startServer(async (request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (path === '/photo.png' || path === '/same.png') {
      response.setHeader('content-type', 'image/png');
      response.end(large);
    } else if (path === '/small.png') {
      response.setHeader('content-type', 'image/png');
      response.end(small);
    } else if (path === '/doc.pdf') {
      response.setHeader('content-type', 'application/pdf');
      response.end(Buffer.from('%PDF-1.4 test'));
    } else if (path === '/flaky.png') {
      flakyCalls += 1;
      if (flakyCalls === 1) {
        response.statusCode = 500;
        response.end();
        return;
      }
      response.setHeader('content-type', 'image/png');
      response.end(small);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
});

afterAll(() => server.close());

const store = async () =>
  new MediaStore({ cacheDir: await mkdtemp(join(tmpdir(), 'media-')), retryDelayMs: 1 });

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
    const dir = await mkdtemp(join(tmpdir(), 'media-'));
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

  it('fails loudly on oversized or missing files', async () => {
    const tiny = new MediaStore({
      cacheDir: await mkdtemp(join(tmpdir(), 'media-')),
      maxBytes: 100,
      retryDelayMs: 1,
    });
    await expect(tiny.ensure(`${server.url}/photo.png`, { kind: 'image' })).rejects.toBeInstanceOf(
      MediaTooLargeError,
    );
    const media = await store();
    await expect(
      media.ensure(`${server.url}/missing.png`, { kind: 'image' }),
    ).rejects.toBeInstanceOf(MediaDownloadError);
  });
});
