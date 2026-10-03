import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { attribute, startTags, type DistIssue } from './dist-check';

// JSON-LD is never executed, so it needs no hash; speculation rules do: Chromium checks them even with 'inline-speculation-rules' present.
const DATA_SCRIPT_TYPES = new Set(['application/ld+json']);

/** The bodies of the scripts a page runs inline; data blocks and external scripts are not hashed. */
export function inlineScripts(html: string): string[] {
  // Only empty bodies are dropped: browsers still check a whitespace-only script against the policy.
  return startTags(html)
    .filter(
      ({ name, tag }) =>
        name === 'script' &&
        attribute(tag, 'src') === undefined &&
        !DATA_SCRIPT_TYPES.has(attribute(tag, 'type') ?? ''),
    )
    .map(({ text }) => text)
    .filter((text) => text !== '');
}

export function scriptHash(body: string): string {
  return `sha256-${createHash('sha256').update(body).digest('base64')}`;
}

export function cspHeader(hashes: string[]): string {
  const scripts = [
    "'self'",
    "'wasm-unsafe-eval'",
    "'inline-speculation-rules'",
    ...hashes.map((hash) => `'${hash}'`),
    'https://giscus.app',
    'https://static.cloudflareinsights.com',
  ];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    'frame-src https://giscus.app https://www.youtube-nocookie.com https://player.vimeo.com',
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

async function htmlFiles(dist: string): Promise<string[]> {
  const entries = await readdir(dist, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** One hash per distinct inline script across the whole build. */
export async function collectScriptHashes(dist: string): Promise<string[]> {
  const hashes = new Set<string>();
  for (const file of await htmlFiles(dist))
    for (const body of inlineScripts(await readFile(file, 'utf8'))) hashes.add(scriptHash(body));
  return [...hashes].sort();
}

/** Any inline script the CSP in _headers does not list would be blocked in production. */
export async function missingCspHashes(dist: string): Promise<DistIssue[]> {
  const file = join(dist, '_headers');
  if (!existsSync(file)) return [{ file: '_headers', message: 'is missing' }];
  const policy = /Content-Security-Policy: (.*)/.exec(await readFile(file, 'utf8'))?.[1] ?? '';
  const listed = new Set(policy.match(/sha256-[A-Za-z0-9+/=]+/g) ?? []);
  const issues: DistIssue[] = [];
  for (const path of await htmlFiles(dist)) {
    for (const body of inlineScripts(await readFile(path, 'utf8'))) {
      const hash = scriptHash(body);
      if (!listed.has(hash))
        issues.push({
          file: relative(dist, path),
          message: `inline script ${hash} is not in the CSP of _headers`,
        });
    }
  }
  return issues;
}
