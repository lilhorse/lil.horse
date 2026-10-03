import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { readEnv } from '../src/env';
import { collectScriptHashes, cspHeader } from '../src/lib/csp';
import { headersFile } from '../src/lib/headers';
import { redirectsFile } from '../src/lib/redirects';
import type { ContentManifest } from '../src/notion/loaders';
import { cachePaths } from '../src/notion/paths';

export async function writeCloudflareFiles(
  dist: string,
  manifest: ContentManifest,
): Promise<{ redirects: number; hashes: number }> {
  const hashes = await collectScriptHashes(dist);
  const redirects = redirectsFile(manifest);
  await writeFile(join(dist, '_redirects'), redirects);
  await writeFile(join(dist, '_headers'), headersFile(cspHeader(hashes)));
  return { redirects: redirects.trim().split('\n').length, hashes: hashes.length };
}

export function cloudflareFiles(): AstroIntegration {
  return {
    name: 'lil-horse-cloudflare',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const paths = cachePaths(readEnv(process.env).fixtures);
        const manifest = JSON.parse(await readFile(paths.content, 'utf8')) as ContentManifest;
        const { redirects, hashes } = await writeCloudflareFiles(fileURLToPath(dir), manifest);
        logger.info(
          `Wrote ${redirects} redirects and a CSP with ${hashes} inline script hash${hashes === 1 ? '' : 'es'}`,
        );
      },
    },
  };
}
