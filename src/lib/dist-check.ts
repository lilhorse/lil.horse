import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join, matchesGlob, posix, relative } from 'node:path';
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
  routes: string[];
}

interface StartTag {
  tag: string;
  name: string;
  text: string;
}

const EXPIRING =
  /X-Amz-|prod-files-secure|secure\.notion-static\.com|file\.notion\.so|img\.notionusercontent\.com/;
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
// These narrow character classes keep the scan linear on malformed markup.
const START_TAG_OR_COMMENT =
  /<!--|<([a-zA-Z][^\s"'<>/=]*)(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?>/g;
const ATTRIBUTE = /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
const TEXT_FILES = new Set([
  '.html',
  '.xml',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.txt',
  '.webmanifest',
  '.svg',
  '.map',
  '_headers',
  '_redirects',
]);

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function startTags(html: string): StartTag[] {
  const tags: StartTag[] = [];
  const pattern = new RegExp(START_TAG_OR_COMMENT);
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const [tag, name] = match;
    if (tag === '<!--') {
      // Browsers close "<!-->" and "<!--->" at once, so "-->" may overlap the opener.
      const end = html.indexOf('-->', match.index + 2);
      pattern.lastIndex = end === -1 ? html.length : end + 3;
      continue;
    }
    let text = '';
    if (name === 'script' || name === 'style') {
      const end = html.indexOf(`</${name}>`, pattern.lastIndex);
      text = html.slice(pattern.lastIndex, end === -1 ? html.length : end);
      pattern.lastIndex += text.length;
    }
    tags.push({ tag, name, text });
  }
  return tags;
}

function attribute(tag: string, wanted: string): string | undefined {
  for (const [, name, double, single, bare] of tag.matchAll(ATTRIBUTE)) {
    if (name === wanted) return double ?? single ?? bare ?? '';
  }
  return undefined;
}

function internalTargets(html: string): string[] {
  const urls: string[] = [];
  for (const { tag } of startTags(html)) {
    for (const [, name, double, single, bare] of tag.matchAll(ATTRIBUTE)) {
      const value = double ?? single ?? bare ?? '';
      if (name === 'href' || name === 'src') urls.push(value);
      else if (name === 'srcset') {
        for (const candidate of value.split(',')) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) urls.push(url);
        }
      }
    }
  }
  return urls
    .filter((url) => url.startsWith('/') && !url.startsWith('//'))
    .map((url) => decodePath(url.split(/[?#]/)[0] ?? url));
}

function resolves(dist: string, path: string): boolean {
  if (path === '/') return isFile(join(dist, 'index.html'));
  const clean = path.replace(/\/+$/, '');
  return [clean, `${clean}.html`, join(clean, 'index.html')].some((candidate) =>
    isFile(join(dist, candidate)),
  );
}

function gzippedFile(dist: string, url: string): number {
  const file = join(dist, url.split(/[?#]/)[0] ?? url);
  return isFile(file) ? gzipSync(readFileSync(file)).length : 0;
}

function moduleSize(dist: string, url: string, seen: Set<string>): number {
  const path = url.split(/[?#]/)[0] ?? url;
  const file = join(dist, path);
  if (seen.has(path) || !isFile(file)) return 0;
  seen.add(path);
  const code = readFileSync(file);
  let size = gzipSync(code).length;
  for (const match of code.toString('utf8').matchAll(STATIC_IMPORT)) {
    const specifier = match[1] ?? '';
    if (/^\.{0,2}\//.test(specifier)) {
      size += moduleSize(dist, posix.resolve(posix.dirname(path), specifier), seen);
    }
  }
  return size;
}

function assetSizes(dist: string, html: string): { js: number; css: number } {
  const modules = new Set<string>();
  let js = 0;
  let css = 0;
  for (const { tag, name, text } of startTags(html)) {
    if (name === 'style') css += gzipSync(text).length;
    else if (name === 'script' && !/type="(application\/ld\+json|speculationrules)"/.test(tag)) {
      const src = /\ssrc="([^"]+)"/.exec(tag)?.[1];
      if (src?.startsWith('/')) js += moduleSize(dist, src, modules);
      else if (text.trim()) js += gzipSync(text).length;
    } else if (name === 'link') {
      const href = attribute(tag, 'href') ?? '';
      if (!href.startsWith('/')) continue;
      const types = attribute(tag, 'rel')?.split(/\s+/) ?? [];
      if (types.includes('modulepreload')) js += moduleSize(dist, href, modules);
      if (types.includes('stylesheet')) css += gzippedFile(dist, href);
    }
  }
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
    routes: [],
    ...overrides,
  };
  const files = await listFiles(dist);
  const names = files.map((file) => relative(dist, file));
  const issues: DistIssue[] = [];
  if (!names.some((name) => extname(name).toLowerCase() === '.html')) {
    issues.push({ file: '', message: 'no HTML files' });
  }
  for (const route of options.routes) {
    if (names.some((name) => matchesGlob(name, route))) continue;
    const path = `/${route.replace(/\.html$/, '').replace(/^index$/, '')}`;
    issues.push({ file: '', message: `missing route ${path} (${route})` });
  }
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!TEXT_FILES.has(extension || basename(file))) continue;
    const name = relative(dist, file);
    const text = readFileSync(file, 'utf8');
    if (EXPIRING.test(text))
      issues.push({ file: name, message: 'contains an expiring Notion file URL' });
    if (extension !== '.html') continue;
    for (const target of new Set(internalTargets(text))) {
      if (target !== '/' && target.endsWith('/'))
        issues.push({ file: name, message: `links with a trailing slash to ${target}` });
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
