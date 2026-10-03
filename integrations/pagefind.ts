import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { close, createIndex } from 'pagefind';
import { serveFrom } from './static-assets';

/** One index for the whole site, segmented as Chinese: English still matches by prefix, Chinese by word. */
export const SEARCH_LANGUAGE = 'zh';

const fail = (what: string, errors: string[]) => new Error(`${what}: ${errors.join('; ')}`);

export async function buildSearchIndex(dist: string): Promise<number> {
  const created = await createIndex({ forceLanguage: SEARCH_LANGUAGE });
  if (!created.index) throw fail('Pagefind could not start', created.errors);
  try {
    const added = await created.index.addDirectory({ path: dist });
    if (added.errors.length > 0) throw fail(`Pagefind could not read ${dist}`, added.errors);
    const out = join(dist, 'pagefind');
    const written = await created.index.writeFiles({ outputPath: out });
    if (written.errors.length > 0) throw fail('Pagefind could not write its index', written.errors);
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
        if (existsSync(built)) server.middlewares.use('/pagefind', serveFrom(built));
      },
      'astro:build:done': async ({ dir, logger }) => {
        const count = await buildSearchIndex(fileURLToPath(dir));
        logger.info(`Indexed ${count} page${count === 1 ? '' : 's'} for search`);
      },
    },
  };
}
