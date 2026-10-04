import { existsSync, fstatSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { join } from 'node:path';
import katex from 'katex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyKatex,
  copyMedia,
  FIXTURE_MARKER,
  markFixtureBuild,
  serveFrom,
  staticAssets,
} from '../../integrations/static-assets';
import { startServer, type TestServer } from '../helpers/http';
import { tempDir } from '../helpers/temp-dir';

type ConfigSetup = Parameters<
  NonNullable<ReturnType<typeof staticAssets>['hooks']['astro:config:setup']>
>[0];

describe('staticAssets config setup', () => {
  const setup = (command: ConfigSetup['command']) => () =>
    staticAssets().hooks['astro:config:setup']?.({ command } as ConfigSetup);

  beforeEach(() => {
    vi.stubEnv('NOTION_SKIP_SYNC', undefined);
    vi.stubEnv('NOTION_INCLUDE_DRAFTS', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [
      'NOTION_SKIP_SYNC',
      'NOTION_SKIP_SYNC is set; it is only for type checks (pnpm check). Unset it to build.',
    ],
    [
      'NOTION_INCLUDE_DRAFTS',
      'NOTION_INCLUDE_DRAFTS is set; it is only for previewing drafts (pnpm dev). Unset it to build.',
    ],
  ])('refuses to build with %s set', (name, message) => {
    vi.stubEnv(name, '1');
    expect(setup('build')).toThrow(message);
  });

  it('names every flag that blocks the build', () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '1');
    vi.stubEnv('NOTION_INCLUDE_DRAFTS', '1');
    expect(setup('build')).toThrow(/NOTION_SKIP_SYNC is set.*\n.*NOTION_INCLUDE_DRAFTS is set/);
  });

  it('builds when neither flag is set', () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '0');
    expect(setup('build')).not.toThrow();
  });

  it('lets type checks run with either flag set', () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '1');
    vi.stubEnv('NOTION_INCLUDE_DRAFTS', '1');
    expect(setup('sync')).not.toThrow();
  });

  it('lets the dev server include drafts', () => {
    vi.stubEnv('NOTION_INCLUDE_DRAFTS', '1');
    expect(setup('dev')).not.toThrow();
  });
});

async function mediaCache(keys: string[]): Promise<string> {
  const root = await tempDir('assets-');
  for (const key of keys) {
    await mkdir(join(root, 'media', key), { recursive: true });
    await writeFile(join(root, 'media', key, 'meta.json'), '{}');
    await writeFile(join(root, 'media', key, '480.webp'), 'x');
  }
  return root;
}

describe('copyMedia', () => {
  it('copies only the manifest entries and leaves meta.json behind', async () => {
    const root = await mediaCache(['k1', 'k2', 'stale']);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(['k1', 'k2']));
    const count = await copyMedia({
      mediaDir: join(root, 'media'),
      manifest: join(root, 'manifest.json'),
      outDir: join(root, 'dist', '_media'),
    });
    expect(count).toBe(2);
    expect(existsSync(join(root, 'dist', '_media', 'k1', '480.webp'))).toBe(true);
    expect(existsSync(join(root, 'dist', '_media', 'k1', 'meta.json'))).toBe(false);
    expect(existsSync(join(root, 'dist', '_media', 'stale'))).toBe(false);
  });

  it('fails when the manifest names media that is not cached', async () => {
    const root = await mediaCache(['k1']);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(['k1', 'gone']));
    await expect(
      copyMedia({
        mediaDir: join(root, 'media'),
        manifest: join(root, 'manifest.json'),
        outDir: join(root, 'out'),
      }),
    ).rejects.toThrow('gone');
  });
});

describe('copyKatex', () => {
  it('copies the stylesheet and fonts under a versioned folder', async () => {
    const out = await tempDir('katex-');
    await copyKatex(out);
    expect(existsSync(join(out, katex.version, 'katex.min.css'))).toBe(true);
    expect(
      (await readdir(join(out, katex.version, 'fonts'))).some((file) => file.endsWith('.woff2')),
    ).toBe(true);
  });
});

describe('markFixtureBuild', () => {
  it('marks the output of a fixture build', async () => {
    const out = await tempDir('marker-');
    await markFixtureBuild(out, { fixtures: true });
    expect(await readdir(out)).toEqual([FIXTURE_MARKER]);
  });

  it('leaves the output of a real build unmarked', async () => {
    const out = await tempDir('marker-');
    await markFixtureBuild(out, { fixtures: false });
    expect(await readdir(out)).toEqual([]);
  });
});

// Not fetch(): it resolves ../ and %2e%2e/ before sending.
function getRaw(base: string, path: string) {
  return new Promise<{ status?: number; type?: string; body: string }>((resolve, reject) => {
    get(base, { path, agent: false, signal: AbortSignal.timeout(2000) }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          type: response.headers['content-type'],
          body: Buffer.concat(chunks).toString(),
        }),
      );
    }).on('error', reject);
  });
}

function isOpen(file: string): boolean {
  const { dev, ino } = statSync(file);
  return readdirSync('/dev/fd').some((fd) => {
    // The listing includes readdir's own descriptor, already closed by now.
    try {
      const stats = fstatSync(Number(fd));
      return stats.dev === dev && stats.ino === ino;
    } catch {
      return false;
    }
  });
}

describe('serveFrom', () => {
  let dir: string;
  let root: string;
  let server: TestServer;

  beforeAll(async () => {
    dir = await tempDir('serve-', { removeAfterTest: false });
    root = join(dir, 'media');
    await mkdir(join(root, 'k'), { recursive: true });
    await mkdir(join(dir, 'media-evil'));
    await writeFile(join(dir, 'x'), 'outside');
    await writeFile(join(dir, 'media-evil', 'x'), 'sibling');
    await writeFile(join(root, 'k', '480.webp'), 'webp');
    await writeFile(join(root, 'k', '数学.pdf'), 'pdf');
    const serve = serveFrom(root);
    server = await startServer((request, response) =>
      serve(request, response, () => response.writeHead(404).end()),
    );
  });

  afterAll(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const next = { status: 404 };
  it.each([
    ['/../x', next],
    ['/%2e%2e/x', next],
    ['/..%2fmedia-evil/x', next],
    ['/', next],
    ['/k/480.webp?v=1', { status: 200, type: 'image/webp', body: 'webp' }],
    ['/k/%E6%95%B0%E5%AD%A6.pdf', { status: 200, type: 'application/pdf', body: 'pdf' }],
  ])('GET %s', async (path, expected) => {
    expect(await getRaw(server.url, path)).toMatchObject(expected);
  });

  it('closes the file when the client aborts', async () => {
    const file = join(root, 'k', 'big.bin');
    await writeFile(file, Buffer.alloc(16 * 1024 * 1024));
    const openWhenAborted = await new Promise<boolean>((resolve, reject) => {
      const request = get(server.url, { path: '/k/big.bin', agent: false }, () => {
        resolve(isOpen(file));
        request.destroy();
      });
      request.on('error', reject);
    });
    expect(openWhenAborted).toBe(true);
    await vi.waitFor(() => expect(isOpen(file)).toBe(false));
  });

  it.skipIf(process.getuid?.() === 0)(
    'drops the connection when the file cannot be read',
    async () => {
      const file = join(root, 'k', 'locked.pdf');
      await writeFile(file, 'pdf');
      await chmod(file, 0);
      await expect(getRaw(server.url, '/k/locked.pdf')).rejects.toMatchObject({
        code: 'ECONNRESET',
      });
    },
  );
});
