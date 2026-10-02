import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entriesFor, writeMediaManifest } from '../../src/notion/loaders';
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

describe('writeMediaManifest', () => {
  it('creates the folder and writes the keys', async () => {
    const file = join(await tempDir('manifest-'), 'nested', 'media-manifest.json');
    await writeMediaManifest(file, ['a', 'b']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['a', 'b']);
  });
});
