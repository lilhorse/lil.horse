import { join } from 'node:path';

export interface CachePaths {
  media: string;
  pages: string;
  bookmarks: string;
  manifest: string;
}

export function cachePaths(fixtures: boolean, root: string = process.cwd()): CachePaths {
  const base = join(root, '.cache', fixtures ? 'fixtures' : 'live');
  return {
    media: join(base, 'media'),
    pages: join(base, 'pages'),
    bookmarks: join(base, 'bookmarks'),
    manifest: join(base, 'media-manifest.json'),
  };
}

export function fixtureDir(root: string = process.cwd()): string {
  return join(root, 'tests', 'fixtures', 'notion');
}
