import { createReadStream, existsSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import katex from 'katex';
import { readEnv, type RuntimeEnv } from '../src/env';
import { cachePaths } from '../src/notion/paths';

const MIME: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export function katexDistDir(): string {
  return dirname(createRequire(import.meta.url).resolve('katex'));
}

export async function copyMedia(options: {
  mediaDir: string;
  manifest: string;
  outDir: string;
}): Promise<number> {
  const keys = JSON.parse(await readFile(options.manifest, 'utf8')) as string[];
  for (const key of keys) {
    const source = join(options.mediaDir, key);
    if (!existsSync(join(source, 'meta.json')))
      throw new Error(`Media ${key} is in the manifest but missing from ${options.mediaDir}`);
    await cp(source, join(options.outDir, key), {
      recursive: true,
      filter: (path) => basename(path) !== 'meta.json',
    });
  }
  return keys.length;
}

export async function copyKatex(outDir: string): Promise<void> {
  const target = join(outDir, katex.version);
  const dist = katexDistDir();
  await mkdir(target, { recursive: true });
  await cp(join(dist, 'katex.min.css'), join(target, 'katex.min.css'));
  await cp(join(dist, 'fonts'), join(target, 'fonts'), { recursive: true });
}

/** Left in a fixture build's output; the screenshot baselines are compared only against such builds. */
export const FIXTURE_MARKER = '.fixture-build';

export async function markFixtureBuild(
  outDir: string,
  env: Pick<RuntimeEnv, 'fixtures'>,
): Promise<void> {
  if (env.fixtures) await writeFile(join(outDir, FIXTURE_MARKER), '');
}

export function serveFrom(root: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      next();
      return;
    }
    response.setHeader(
      'content-type',
      MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    );
    // pipe() leaves the file open when the client aborts.
    pipeline(createReadStream(file), response, () => undefined);
  };
}

export function staticAssets(): AstroIntegration {
  return {
    name: 'lil-horse-static-assets',
    hooks: {
      'astro:config:setup': ({ command }) => {
        if (command !== 'build') return;
        const env = readEnv(process.env);
        const problems: string[] = [];
        if (env.skipSync)
          problems.push(
            'NOTION_SKIP_SYNC is set; it is only for type checks (pnpm check). Unset it to build.',
          );
        if (env.includeDrafts)
          problems.push(
            'NOTION_INCLUDE_DRAFTS is set; it is only for previewing drafts (pnpm dev). Unset it to build.',
          );
        if (problems.length > 0) throw new Error(problems.join('\n'));
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(
          '/_media',
          serveFrom(cachePaths(readEnv(process.env).fixtures).media),
        );
        server.middlewares.use(`/katex/${katex.version}`, serveFrom(katexDistDir()));
      },
      'astro:build:done': async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const env = readEnv(process.env);
        const paths = cachePaths(env.fixtures);
        const count = await copyMedia({
          mediaDir: paths.media,
          manifest: paths.manifest,
          outDir: join(out, '_media'),
        });
        await copyKatex(join(out, 'katex'));
        await markFixtureBuild(out, env);
        logger.info(`Copied ${count} media items and KaTeX ${katex.version} assets`);
      },
    },
  };
}
