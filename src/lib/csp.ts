import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { attribute, startTags, type DistIssue } from './dist-check';
import { headersFor, parseHeaders } from './headers';

// A hash in script-src disables 'inline-speculation-rules', so speculation rules need their own hash; JSON-LD never runs.
const DATA_SCRIPT_TYPES = new Set(['application/ld+json']);
const UNSAFE_SCRIPT_SOURCES = ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'"];
// Deliberately simpler than startTags, so a mistake in the scan cannot hide behind the scan.
const PLAIN_SCRIPT =
  /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<script(?=[\s/>])([^>]*)>([\s\S]*?)(?:<\/script[\s/>]|$)/gi;

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

function countInlineScripts(html: string): number {
  let count = 0;
  for (const [, attributes = '', body] of html.matchAll(PLAIN_SCRIPT)) {
    if (body && !/[\s/]src\s*=/i.test(attributes) && !/application\/ld\+json/i.test(attributes))
      count += 1;
  }
  return count;
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
    // Giscus's client adds its frame stylesheet, giscus.app/default.css, to the page.
    "style-src 'self' 'unsafe-inline' https://giscus.app",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    'frame-src https://giscus.app https://www.youtube-nocookie.com https://player.vimeo.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The built pages; uploads under _media/ run under a sandbox policy of their own. */
async function htmlFiles(dist: string): Promise<string[]> {
  const entries = await readdir(dist, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => relative(dist, file).split(sep)[0] !== '_media')
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
  const rules = parseHeaders(await readFile(file, 'utf8'));
  const policy = headersFor(rules, '/')['content-security-policy'] ?? '';
  const listed = new Set(policy.match(/sha256-[A-Za-z0-9+/=]+/g) ?? []);
  const sources = /(?:^|;)\s*script-src ([^;]*)/.exec(policy)?.[1]?.split(/\s+/) ?? [];
  const issues: DistIssue[] = UNSAFE_SCRIPT_SOURCES.filter((keyword) =>
    sources.includes(keyword),
  ).map((keyword) => ({ file: '_headers', message: `script-src allows ${keyword}` }));
  for (const path of await htmlFiles(dist)) {
    const html = await readFile(path, 'utf8');
    const page = relative(dist, path);
    const bodies = inlineScripts(html);
    for (const body of bodies) {
      const hash = scriptHash(body);
      if (!listed.has(hash))
        issues.push({ file: page, message: `inline script ${hash} is not in the CSP of _headers` });
    }
    const counted = countInlineScripts(html);
    if (counted !== bodies.length)
      issues.push({
        file: page,
        message: `inline scripts: a plain count finds ${counted}, the CSP scan read ${bodies.length}`,
      });
    if (startTags(html).some(({ name, foreign }) => name === 'script' && foreign))
      issues.push({
        file: page,
        message: 'has a script inside <svg> or <math>, which the CSP scan cannot hash',
      });
  }
  return issues;
}
