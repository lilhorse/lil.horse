import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { HtmlValidate, StaticConfigLoader } from 'html-validate';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDist } from '../../src/lib/dist-check';

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function dist(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dist-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const noValidation = { jsBudgetBytes: 200, cssBudgetBytes: 200, validator: null };
const zeroBudgets = { ...noValidation, jsBudgetBytes: 0, cssBudgetBytes: 0 };

describe('checkDist', () => {
  it('accepts a clean site', async () => {
    const root = await dist({
      'index.html': page(
        '<a href="/blog">blog</a><img src="/_media/k/480.webp" srcset="/_media/k/480.webp 480w" alt="">',
      ),
      'blog.html': page('<a href="/">home</a>'),
      '_media/k/480.webp': 'x',
    });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it('reports expiring URLs, missing targets and budget overruns', async () => {
    const noise = randomBytes(3000).toString('base64');
    const root = await dist({
      'index.html': page(
        `<a href="/missing">x</a><img src="https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?X-Amz-Signature=1" alt=""><script>${noise}</script><style>${noise}</style>`,
      ),
    });
    const messages = (await checkDist(root, noValidation)).map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'contains an expiring Notion file URL',
        'links to missing /missing',
        expect.stringMatching(/^initial JavaScript is \d+ bytes gzipped/),
        expect.stringMatching(/^CSS is \d+ bytes gzipped/),
      ]),
    );
  });

  it.each(['_headers', '_redirects', 'icon.svg', '_astro/entry.js.map'])(
    'scans %s for expiring URLs',
    async (file) => {
      const root = await dist({
        'index.html': page(''),
        [file]: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?X-Amz-Signature=1',
      });
      expect(await checkDist(root, noValidation)).toEqual([
        { file, message: 'contains an expiring Notion file URL' },
      ]);
    },
  );

  it('reports URLs of the Notion image proxy as expiring', async () => {
    const root = await dist({
      'index.html': page(
        '<img src="https://img.notionusercontent.com/ext/https%3A%2F%2Fexample.com%2Fa.png/size/w=2000?exp=1&amp;sig=abc" alt="">',
      ),
    });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'contains an expiring Notion file URL' },
    ]);
  });

  it('treats a directory as a missing page', async () => {
    const root = await dist({
      'index.html': page('<a href="/blog">blog</a>'),
      'blog/x.html': page(''),
    });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'links to missing /blog' },
    ]);
  });

  it('reports a malformed percent-encoded link instead of throwing', async () => {
    const root = await dist({ 'index.html': page('<a href="/50%-off">sale</a>') });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'links to missing /50%-off' },
    ]);
  });

  it.each([
    { problem: 'a NUL byte', href: '/x%00y', target: '/x\u0000y' },
    {
      problem: 'an over-long name',
      href: `/blog/${'a'.repeat(300)}`,
      target: `/blog/${'a'.repeat(300)}`,
    },
  ])('reports a link with $problem as missing instead of throwing', async ({ href, target }) => {
    const root = await dist({
      'index.html': page(`<a href="${href}">x</a>`),
      // The lookup reaches an over-long name only when its parent directory exists.
      'blog/post.html': page(''),
    });
    await expect(checkDist(root, noValidation)).resolves.toEqual([
      { file: 'index.html', message: `links to missing ${target}` },
    ]);
  });

  it('reports internal links with a trailing slash', async () => {
    const root = await dist({
      'index.html': page('<a href="/">home</a><a href="/blog/">blog</a>'),
      'blog.html': page(''),
    });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'links with a trailing slash to /blog/' },
    ]);
  });

  it.each([
    { where: 'a code block', body: '<pre><code>&lt;img src="/nope.png"&gt;</code></pre>' },
    { where: 'inline code', body: '<p>Use <code>&lt;img src="/nope.png"&gt;</code> here.</p>' },
  ])('ignores markup shown as text in $where', async ({ body }) => {
    const root = await dist({ 'index.html': page(body) });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it('still checks a real link inside code', async () => {
    const root = await dist({ 'index.html': page('<code><a href="/missing">x</a></code>') });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'links to missing /missing' },
    ]);
  });

  it('ignores markup inside a script', async () => {
    const root = await dist({
      'index.html': page(`<script>const link = '<a href="/missing">';</script>`),
    });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it.each(['<!-- the <script> below is hoisted -->', '<!-->', '<!--->'])(
    'checks links after the comment %s',
    async (comment) => {
      const root = await dist({ 'index.html': page(`${comment}<a href="/missing">x</a>`) });
      expect(await checkDist(root, zeroBudgets)).toEqual([
        { file: 'index.html', message: 'links to missing /missing' },
      ]);
    },
  );

  it.each([
    '<!-- <style> -->',
    '<!-- <a href="/missing">x</a> -->',
    '<!-- <a href="/missing">x</a>',
  ])('ignores markup inside the comment %s', async (body) => {
    const root = await dist({ 'index.html': page(body) });
    expect(await checkDist(root, zeroBudgets)).toEqual([]);
  });

  it('reads attributes that follow a quoted >', async () => {
    const root = await dist({
      'index.html': page('<img alt="Settings > Privacy" src="/missing.webp">'),
    });
    expect(await checkDist(root, noValidation)).toEqual([
      { file: 'index.html', message: 'links to missing /missing.webp' },
    ]);
  });

  it('scans markup full of unclosed tags in linear time', { timeout: 1000 }, async () => {
    const root = await dist({ 'index.html': page('<a b="c" '.repeat(20_000)) });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it.each([' b="<a"', " b='<a'", ' b="<a="'])(
    'scans an unclosed tag repeating%s in linear time',
    { timeout: 1000 },
    async (attribute) => {
      const root = await dist({ 'index.html': page(`<a${attribute.repeat(20_000)}`) });
      expect(await checkDist(root, noValidation)).toEqual([]);
    },
  );

  it('scans a long run of unclosed link tags in linear time', { timeout: 1000 }, async () => {
    const root = await dist({
      'index.html': page(`<button data-code="${'<link '.repeat(40_000)}">copy</button>`),
    });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it('counts modulepreload and stylesheet links and checks their targets', async () => {
    const root = await dist({
      'index.html': page(
        '<link rel="modulepreload" href="/_astro/a.js"><link rel="stylesheet" href="/_astro/a.css"><link rel="modulepreload" href="/_astro/gone.js"><link rel="stylesheet" href="/_astro/gone.css">',
      ),
      '_astro/a.js': 'export const a = 1;',
      '_astro/a.css': 'a{color:red}',
    });
    expect(await checkDist(root, zeroBudgets)).toEqual([
      { file: 'index.html', message: 'links to missing /_astro/gone.js' },
      { file: 'index.html', message: 'links to missing /_astro/gone.css' },
      {
        file: 'index.html',
        message: `initial JavaScript is ${gzipSync('export const a = 1;').length} bytes gzipped; the budget is 0`,
      },
      {
        file: 'index.html',
        message: `CSS is ${gzipSync('a{color:red}').length} bytes gzipped; the budget is 0`,
      },
    ]);
  });

  it('reports pages that preload more than two font files', async () => {
    const font = (name: string) =>
      `<link rel="preload" href="/_astro/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin>`;
    const files = {
      '_astro/fonts/a.woff2': 'a',
      '_astro/fonts/b.woff2': 'b',
      '_astro/fonts/c.woff2': 'c',
    };
    const two = await dist({ ...files, 'index.html': page(font('a') + font('b')) });
    const three = await dist({ ...files, 'index.html': page(font('a') + font('b') + font('c')) });
    expect(await checkDist(two, noValidation)).toEqual([]);
    expect(await checkDist(three, noValidation)).toEqual([
      { file: 'index.html', message: 'preloads 3 font files; the budget is 2' },
    ]);
  });

  it('reads rel as a list of link types', async () => {
    const root = await dist({
      'index.html': page('<link rel="preload stylesheet" as="style" href="/_astro/a.css">'),
      '_astro/a.css': 'a{color:red}',
    });
    expect(await checkDist(root, zeroBudgets)).toEqual([
      {
        file: 'index.html',
        message: `CSS is ${gzipSync('a{color:red}').length} bytes gzipped; the budget is 0`,
      },
    ]);
  });

  it('counts modules that an entry script imports statically', async () => {
    const noise = randomBytes(3000).toString('base64');
    const root = await dist({
      'index.html': page('<script type="module" src="/_astro/entry.js"></script>'),
      '_astro/entry.js': 'import{t as e}from"./shared.js";e();',
      '_astro/shared.js': `export const t = () => ${JSON.stringify(noise)};`,
    });
    const messages = (await checkDist(root, noValidation)).map((issue) => issue.message);
    expect(messages).toEqual([expect.stringMatching(/^initial JavaScript is \d+ bytes gzipped/)]);
  });

  it('ignores lazily imported modules', async () => {
    const noise = randomBytes(3000).toString('base64');
    const root = await dist({
      'index.html': page('<script type="module" src="/_astro/entry.js"></script>'),
      '_astro/entry.js': 'import("./lazy.js");',
      '_astro/lazy.js': `export const t = ${JSON.stringify(noise)};`,
    });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it('counts inline scripts and styles', async () => {
    const root = await dist({ 'index.html': page('<script>let x = 1</script><style>a{}</style>') });
    expect(await checkDist(root, zeroBudgets)).toEqual([
      {
        file: 'index.html',
        message: `initial JavaScript is ${gzipSync('let x = 1').length} bytes gzipped; the budget is 0`,
      },
      {
        file: 'index.html',
        message: `CSS is ${gzipSync('a{}').length} bytes gzipped; the budget is 0`,
      },
    ]);
  });

  it('ignores script and style markup inside an attribute value', async () => {
    const root = await dist({
      'index.html': page(
        '<button data-code="<script>let x = 1</script><style>a{}</style>">copy</button>',
      ),
    });
    expect(await checkDist(root, zeroBudgets)).toEqual([]);
  });

  it('ignores JSON-LD and speculation rules', async () => {
    const root = await dist({
      'index.html': page(
        '<script type="application/ld+json">{"@type":"Person"}</script><script type="speculationrules">{"prefetch":[]}</script>',
      ),
    });
    expect(await checkDist(root, zeroBudgets)).toEqual([]);
  });

  it('reports a build without any HTML', async () => {
    const root = await dist({});
    expect(await checkDist(root, noValidation)).toEqual([{ file: '', message: 'no HTML files' }]);
  });

  it('reports each missing route', async () => {
    const root = await dist({ 'about.html': page('') });
    const routes = ['index.html', 'about.html', '404.html'];
    expect(await checkDist(root, { ...noValidation, routes })).toEqual([
      { file: '', message: 'missing route / (index.html)' },
      { file: '', message: 'missing route /404 (404.html)' },
    ]);
  });

  it('reports a route pattern that matches no page', async () => {
    const root = await dist({ 'index.html': page(''), 'blog.html': page('') });
    await mkdir(join(root, 'blog'));
    const routes = ['blog.html', 'blog/*.html'];
    expect(await checkDist(root, { ...noValidation, routes })).toEqual([
      { file: '', message: 'missing route /blog/* (blog/*.html)' },
    ]);
  });

  it('reports HTML validation errors', async () => {
    const root = await dist({ 'index.html': page('<p id="x">one</p><p id="x">two</p>') });
    const validator = new HtmlValidate(
      new StaticConfigLoader({ extends: ['html-validate:standard'] }),
    );
    const issues = await checkDist(root, { ...noValidation, validator });
    expect(issues.some((issue) => issue.message.startsWith('html-validate no-dup-id'))).toBe(true);
  });

  it("applies only the repo's html-validate config", async () => {
    const root = await dist({
      '.htmlvalidate.json': JSON.stringify({ extends: ['html-validate:recommended'] }),
      'site/.htmlvalidate.json': await readFile(
        new URL('../../.htmlvalidate.json', import.meta.url),
        'utf8',
      ),
      'site/dist/index.html': page(
        '<pre><code><div class="ec-line">x</div></code></pre><ul><div>x</div></ul>',
      ),
    });
    const messages = (await checkDist(join(root, 'site', 'dist'))).map((issue) => issue.message);
    expect(messages).toEqual([
      expect.stringMatching(/^html-validate element-permitted-content: .* under <ul>/),
    ]);
  });
});
