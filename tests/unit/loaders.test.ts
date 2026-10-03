import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoaderContext } from 'astro/loaders';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  entriesFor,
  notionLoader,
  statusesFor,
  writeMediaManifest,
} from '../../src/notion/loaders';
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

describe('notionLoader', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips the sync and leaves the store alone when NOTION_SKIP_SYNC is set', async () => {
    vi.stubEnv('NOTION_SKIP_SYNC', '1');
    // Without a token or fixtures, any sync attempt fails instead of reaching Notion.
    vi.stubEnv('NOTION_TOKEN', undefined);
    vi.stubEnv('NOTION_FIXTURES', undefined);
    const store = { clear: vi.fn(), set: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const context = { store, logger, generateDigest: () => 'digest' };

    await notionLoader('posts').load(context as unknown as LoaderContext);

    expect(store.clear).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      'Skipping the Notion sync (NOTION_SKIP_SYNC=1)',
    );
  });
});
