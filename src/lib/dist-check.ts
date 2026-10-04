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
  fontPreloadBudget: number;
  validator: HtmlValidate | null;
  routes: string[];
  /** The site's origin; absolute share-image addresses under it must exist in dist. */
  site: string | null;
}

export interface StartTag {
  tag: string;
  name: string;
  text: string;
  /** Inside <svg> or <math>, where a script's text is parsed as markup. */
  foreign: boolean;
}

const EXPIRING =
  /X-Amz-|prod-files-secure|secure\.notion-static\.com|file\.notion\.so|img\.notionusercontent\.com/;
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
// These narrow character classes keep the scan linear on malformed markup.
const START_TAG_OR_COMMENT =
  /<!--|<\/(svg|math)[\s/>]|<([a-z][^\s"'<>/=]*)(?:(?:\s+|(?<=["']))[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?>/gi;
const ATTRIBUTE = /(?:\s|(?<=["']))([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
// After "<!--", a "<script" start keeps the next "</script>" inside the text, as browsers parse it.
const SCRIPT_DATA = /<!--|-->|<(\/?)script[\t\n\f\r />]/gi;
const STYLE_END = /<\/style[\t\n\f\r />]/gi;
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

function commentEnd(html: string, start: number): number {
  // Browsers close "<!-->" and "<!--->" at once, so "-->" may overlap the opener; "--!>" also closes.
  const plain = html.indexOf('-->', start + 2);
  const bang = html.indexOf('--!>', start + 4);
  if (bang !== -1 && (plain === -1 || bang < plain)) return bang + 4;
  return plain === -1 ? html.length : plain + 3;
}

function nextIndex(pattern: RegExp, html: string, from: number): number {
  const search = new RegExp(pattern);
  search.lastIndex = from;
  return search.exec(html)?.index ?? html.length;
}

function scriptEnd(html: string, from: number): number {
  const token = new RegExp(SCRIPT_DATA);
  token.lastIndex = from;
  let state: 'data' | 'escaped' | 'double' = 'data';
  for (let match = token.exec(html); match; match = token.exec(html)) {
    if (match[0] === '<!--') {
      if (state === 'data') state = 'escaped';
      token.lastIndex = match.index + 2;
    } else if (match[0] === '-->') state = 'data';
    else if (!match[1]) {
      if (state === 'escaped') state = 'double';
    } else if (state === 'double') state = 'escaped';
    else return match.index;
  }
  return html.length;
}

/** Every start tag in document order; script and style tags carry their text as the browser parses it. */
export function startTags(html: string): StartTag[] {
  const tags: StartTag[] = [];
  const pattern = new RegExp(START_TAG_OR_COMMENT);
  let foreignDepth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const [tag, foreignEnd, rawName = ''] = match;
    if (tag === '<!--') {
      pattern.lastIndex = commentEnd(html, match.index);
      continue;
    }
    if (foreignEnd) {
      foreignDepth = Math.max(0, foreignDepth - 1);
      continue;
    }
    const name = rawName.toLowerCase();
    const foreign = foreignDepth > 0;
    if ((name === 'svg' || name === 'math') && !tag.endsWith('/>')) foreignDepth += 1;
    let text = '';
    if (name === 'script' || name === 'style') {
      const from = pattern.lastIndex;
      const end = name === 'script' ? scriptEnd(html, from) : nextIndex(STYLE_END, html, from);
      text = html.slice(from, end).replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD');
      pattern.lastIndex = end;
    }
    tags.push({ tag, name, text, foreign });
  }
  return tags;
}

export function attribute(tag: string, wanted: string): string | undefined {
  for (const [, name, double, single, bare] of tag.matchAll(ATTRIBUTE)) {
    if (name?.toLowerCase() === wanted) return double ?? single ?? bare ?? '';
  }
  return undefined;
}

const IMAGE_META = /^(og:image|twitter:image)$/;

function internalTargets(html: string, site: string | null): string[] {
  const urls: string[] = [];
  for (const { tag, name: element } of startTags(html)) {
    if (element === 'meta') {
      const key = attribute(tag, 'property') ?? attribute(tag, 'name') ?? '';
      const content = attribute(tag, 'content') ?? '';
      if (IMAGE_META.test(key) && site && content.startsWith(site))
        urls.push(content.slice(site.length));
      continue;
    }
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

export function resolves(dist: string, path: string): boolean {
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

function assetSizes(dist: string, html: string): { js: number; css: number; fonts: number } {
  const modules = new Set<string>();
  let js = 0;
  let css = 0;
  let fonts = 0;
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
      if (types.includes('preload') && attribute(tag, 'as') === 'font') fonts += 1;
    }
  }
  return { js, css, fonts };
}

export async function checkDist(
  dist: string,
  overrides: Partial<Options> = {},
): Promise<DistIssue[]> {
  const options: Options = {
    jsBudgetBytes: 15 * 1024,
    cssBudgetBytes: 20 * 1024,
    fontPreloadBudget: 2,
    validator: new HtmlValidate(new FileSystemConfigLoader()),
    routes: [],
    site: null,
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
    for (const target of new Set(internalTargets(text, options.site))) {
      if (target !== '/' && target.endsWith('/'))
        issues.push({ file: name, message: `links with a trailing slash to ${target}` });
      if (!resolves(dist, target))
        issues.push({ file: name, message: `links to missing ${target}` });
      else if (target.endsWith('.html')) {
        const page = target.replace(/(?:\/index)?\.html$/, '') || '/';
        issues.push({ file: name, message: `links to ${target} instead of ${page}` });
      }
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
    if (sizes.fonts > options.fontPreloadBudget) {
      issues.push({
        file: name,
        message: `preloads ${sizes.fonts} font files; the budget is ${options.fontPreloadBudget}`,
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
