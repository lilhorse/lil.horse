import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate';

export interface DistIssue {
  file: string;
  message: string;
}

interface Options {
  jsBudgetBytes: number;
  cssBudgetBytes: number;
  validator: HtmlValidate | null;
}

const EXPIRING = /X-Amz-|prod-files-secure|secure\.notion-static\.com|file\.notion\.so/;
const TEXT_FILES = new Set([
  '.html',
  '.xml',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.txt',
  '.webmanifest',
]);

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function internalTargets(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) if (match[1]) urls.push(match[1]);
  for (const match of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const candidate of (match[1] ?? '').split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls
    .filter((url) => url.startsWith('/') && !url.startsWith('//'))
    .map((url) => decodeURIComponent(url.split(/[?#]/)[0] ?? url));
}

function resolves(dist: string, path: string): boolean {
  if (path === '/') return existsSync(join(dist, 'index.html'));
  const clean = path.replace(/\/+$/, '');
  return [clean, `${clean}.html`, join(clean, 'index.html')].some((candidate) =>
    existsSync(join(dist, candidate)),
  );
}

function gzippedFile(dist: string, url: string): number {
  const file = join(dist, url.split(/[?#]/)[0] ?? url);
  return existsSync(file) ? gzipSync(readFileSync(file)).length : 0;
}

function assetSizes(dist: string, html: string): { js: number; css: number } {
  let js = 0;
  let css = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (/type="(application\/ld\+json|speculationrules)"/.test(attributes)) continue;
    const src = /\ssrc="([^"]+)"/.exec(attributes)?.[1];
    if (src?.startsWith('/')) js += gzippedFile(dist, src);
    else if (body.trim()) js += gzipSync(body).length;
  }
  for (const match of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(match[0])?.[1];
    if (href?.startsWith('/')) js += gzippedFile(dist, href);
  }
  for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(match[0])?.[1];
    if (href?.startsWith('/')) css += gzippedFile(dist, href);
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g))
    css += gzipSync(match[1] ?? '').length;
  return { js, css };
}

export async function checkDist(
  dist: string,
  overrides: Partial<Options> = {},
): Promise<DistIssue[]> {
  const options: Options = {
    jsBudgetBytes: 15 * 1024,
    cssBudgetBytes: 20 * 1024,
    validator: new HtmlValidate(new FileSystemConfigLoader()),
    ...overrides,
  };
  const issues: DistIssue[] = [];
  for (const file of await listFiles(dist)) {
    const extension = extname(file).toLowerCase();
    if (!TEXT_FILES.has(extension)) continue;
    const name = relative(dist, file);
    const text = readFileSync(file, 'utf8');
    if (EXPIRING.test(text))
      issues.push({ file: name, message: 'contains an expiring Notion file URL' });
    if (extension !== '.html') continue;
    for (const target of new Set(internalTargets(text))) {
      if (!resolves(dist, target))
        issues.push({ file: name, message: `links to missing ${target}` });
    }
    const sizes = assetSizes(dist, text);
    if (sizes.js > options.jsBudgetBytes) {
      issues.push({
        file: name,
        message: `initial JavaScript is ${sizes.js} bytes gzipped; the budget is ${options.jsBudgetBytes}`,
      });
    }
    if (sizes.css > options.cssBudgetBytes) {
      issues.push({
        file: name,
        message: `CSS is ${sizes.css} bytes gzipped; the budget is ${options.cssBudgetBytes}`,
      });
    }
    if (options.validator) {
      const report = await options.validator.validateFile(file);
      for (const result of report.results) {
        for (const message of result.messages) {
          if (message.severity === 2)
            issues.push({
              file: name,
              message: `html-validate ${message.ruleId}: ${message.message} (line ${message.line})`,
            });
        }
      }
    }
  }
  return issues;
}
