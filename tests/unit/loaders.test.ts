import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoaderContext } from 'astro/loaders';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entriesFor, statusesFor, writeMediaManifest } from '../../src/notion/loaders';
import type { SiteContent } from '../../src/notion/types';
import { tempDir } from '../helpers/temp-dir';

const site = {
  posts: [{ id: 'a', slug: 'helloworld' }],
  projects: [{ id: 'p1' }],
  profile: { id: 'me', name: "Lil'Horse" },
  pages: [{ id: 'b', key: 'about' }],
  mediaKeys: [],
  warnings: [],
} as unknown as SiteContent;

beforeEach(() => {
  vi.stubEnv('NOTION_SKIP_SYNC', undefined);
  // Without a token or fixtures, any sync attempt fails instead of reaching Notion.
  vi.stubEnv('NOTION_TOKEN', undefined);
  vi.stubEnv('NOTION_FIXTURES', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function freshLoaders() {
  vi.resetModules();
  return import('../../src/notion/loaders');
}

const notionLogger = () => ({ info: vi.fn(), warn: vi.fn() });

function loaderContext(notion: ReturnType<typeof notionLogger>) {
  return {
    store: { clear: vi.fn(), set: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), fork: vi.fn(() => notion) },
    generateDigest: () => 'digest',
  };
}

describe('entriesFor', () => {
  it('keys each collection the way the routes expect', () => {
    expect(entriesFor(site, 'posts').map(([id]) => id)).toEqual(['helloworld']);
    expect(entriesFor(site, 'projects').map(([id]) => id)).toEqual(['p1']);
    expect(entriesFor(site, 'pages').map(([id]) => id)).toEqual(['about']);
    expect(entriesFor(site, 'profile')).toEqual([['profile', { id: 'me', name: "Lil'Horse" }]]);
  });
});

describe('statusesFor', () => {
  it('publishes Published and Unlisted posts', () => {
    expect(statusesFor(false)).toEqual(['Published', 'Unlisted']);
  });

  it('adds Draft posts only when drafts are included', () => {
    expect(statusesFor(true)).toEqual(['Draft', 'Published', 'Unlisted']);
  });
});

describe('writeMediaManifest', () => {
  it('creates the folder and writes the keys', async () => {
    const file = join(await tempDir('manifest-'), 'nested', 'media-manifest.json');
    await writeMediaManifest(file, ['a', 'b']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['a', 'b']);
  });
});

describe('loadSiteContent', () => {
  it('logs the sync under the notion tag', async () => {
    const { loadSiteContent } = await freshLoaders();
    const { logger } = loaderContext(notionLogger());
    await loadSiteContent(logger as unknown as LoaderContext['logger']).catch(() => undefined);
    expect(logger.fork).toHaveBeenCalledExactlyOnceWith('notion');
  });

  it('explains where the token has to come from', async () => {
    const { loadSiteContent } = await freshLoaders();
    const logger = loaderContext(notionLogger()).logger as unknown as LoaderContext['logger'];
    await expect(loadSiteContent(logger)).rejects.toThrow(
      'NOTION_TOKEN is not set. Put it in .env and build with pnpm build / pnpm dev (they load .env), or run pnpm build:fixtures to build offline.',
    );
  });

  it('runs a fresh sync after a failed one', async () => {
    const { loadSiteContent } = await freshLoaders();
    const logger = loaderContext(notionLogger()).logger as unknown as LoaderContext['logger'];
    const first: unknown = await loadSiteContent(logger).catch((error: unknown) => error);
    const second: unknown = await loadSiteContent(logger).catch((error: unknown) => error);
    expect(first).toMatchObject({ message: expect.stringContaining('NOTION_TOKEN is not set') });
    expect(second).toMatchObject({ message: expect.stringContaining('NOTION_TOKEN is not set') });
    // A memoised failure would hand back the same error.
    expect(second).not.toBe(first);
  });
});

describe('notionLoader', () => {
  it('skips the sync and leaves the store alone when NOTION_SKIP_SYNC is set', async () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '1');
    const { notionLoader } = await freshLoaders();
    const notion = notionLogger();
    const context = loaderContext(notion);

    await notionLoader('posts').load(context as unknown as LoaderContext);

    expect(context.store.clear).not.toHaveBeenCalled();
    expect(context.store.set).not.toHaveBeenCalled();
    expect(notion.info).toHaveBeenCalledExactlyOnceWith(
      'Skipping the Notion sync (NOTION_SKIP_SYNC=1)',
    );
  });

  it('says it skipped the sync once, however many collections load', async () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '1');
    const { notionLoader } = await freshLoaders();
    const notion = notionLogger();
    const contexts = [];
    for (const collection of ['posts', 'projects', 'profile', 'pages'] as const) {
      const context = loaderContext(notion);
      await notionLoader(collection).load(context as unknown as LoaderContext);
      contexts.push(context);
    }

    expect(notion.info).toHaveBeenCalledOnce();
    for (const context of contexts) expect(context.logger.info).not.toHaveBeenCalled();
  });
});
