import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { close, createIndex } from 'pagefind';
import { attribute, startTags } from '../src/lib/dist-check';
import { serveFrom } from './static-assets';

/** One index for the whole site, segmented as Chinese: English still matches by prefix, Chinese by word. */
export const SEARCH_LANGUAGE = 'zh';

// The palette loads pagefind.js, which loads its worker, wasm and index; Pagefind's UI bundles go unused.
const UNUSED_FILE = /^pagefind-(?:ui|component-ui|modular-ui|highlight)\./;
// Browsers refuse a module script served as application/octet-stream; the index and wasm files are binary.
const SEARCH_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

const fail = (what: string, errors: string[]) => new Error(`${what}: ${errors.join('; ')}`);

async function hasSearchBody(dist: string): Promise<boolean> {
  for (const entry of await readdir(dist, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const html = await readFile(join(entry.parentPath, entry.name), 'utf8');
    if (startTags(html).some(({ tag }) => attribute(tag, 'data-pagefind-body') !== undefined))
      return true;
  }
  return false;
}

export async function buildSearchIndex(dist: string): Promise<number> {
  if (!(await hasSearchBody(dist)))
    throw new Error(
      `No page under ${dist} carries data-pagefind-body, so Pagefind would index every page whole`,
    );
  const created = await createIndex({ forceLanguage: SEARCH_LANGUAGE });
  if (!created.index) throw fail('Pagefind could not start', created.errors);
  try {
    const added = await created.index.addDirectory({ path: dist });
    if (added.errors.length > 0) throw fail(`Pagefind could not read ${dist}`, added.errors);
    const out = join(dist, 'pagefind');
    const built = await created.index.getFiles();
    if (built.errors.length > 0) throw fail('Pagefind could not write its index', built.errors);
    for (const file of built.files.filter(({ path }) => !UNUSED_FILE.test(path))) {
      await mkdir(dirname(join(out, file.path)), { recursive: true });
      await writeFile(join(out, file.path), file.content);
    }
    // addDirectory counts every HTML file; the entry file counts the pages that carry data-pagefind-body.
    const entry = JSON.parse(await readFile(join(out, 'pagefind-entry.json'), 'utf8')) as {
      languages: Record<string, { page_count: number }>;
    };
    const indexed = Object.values(entry.languages).reduce(
      (sum, { page_count }) => sum + page_count,
      0,
    );
    if (indexed === 0) throw new Error(`Pagefind indexed no page under ${dist}`);
    return indexed;
  } finally {
    await close();
  }
}

export function searchIndex(): AstroIntegration {
  return {
    name: 'lil-horse-search',
    hooks: {
      'astro:server:setup': ({ server }) => {
        const built = join(process.cwd(), 'dist', 'pagefind');
        if (existsSync(built)) server.middlewares.use('/pagefind', serveFrom(built, SEARCH_TYPES));
      },
      'astro:build:done': async ({ dir, logger }) => {
        const count = await buildSearchIndex(fileURLToPath(dir));
        logger.info(`Indexed ${count} page${count === 1 ? '' : 's'} for search`);
      },
    },
  };
}
