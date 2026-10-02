import { describe, expect, it } from 'vitest';
import { formatBytes, hostnameOf, renderCell, renderRichText } from '../../src/lib/html';
import type { Annotations, RichTextSpan } from '../../src/notion/types';

const base: Annotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
};
const span = (
  text: string,
  overrides: Partial<Annotations> = {},
  link: { href?: string; pageId?: string } = {},
): RichTextSpan => ({
  kind: 'text',
  text,
  annotations: { ...base, ...overrides },
  href: link.href ?? null,
  pageId: link.pageId ?? null,
});
const HELLO = 'a'.repeat(32);
const resolve = (pageId: string) =>
  pageId === HELLO ? { url: '/blog/helloworld', title: 'Hello World' } : undefined;

describe('renderRichText', () => {
  it('escapes text and nests annotations', () => {
    expect(
      renderRichText(
        [span('<b> & "x"', { bold: true, italic: true, code: true, color: 'red' })],
        resolve,
      ),
    ).toBe('<span class="c-red"><em><strong><code>&lt;b&gt; &amp; "x"</code></strong></em></span>');
  });

  it('resolves internal links, keeps safe external links and drops the rest', () => {
    expect(renderRichText([span('post', {}, { pageId: HELLO, href: `/${HELLO}` })], resolve)).toBe(
      '<a href="/blog/helloworld">post</a>',
    );
    expect(
      renderRichText([span('gone', {}, { pageId: 'b'.repeat(32), href: '/b' })], resolve),
    ).toBe('gone');
    expect(
      renderRichText([span('site', {}, { href: 'https://example.com/?a=1&b=2' })], resolve),
    ).toBe('<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">site</a>');
    expect(renderRichText([span('xss', {}, { href: 'javascript:alert(1)' })], resolve)).toBe('xss');
  });

  it('renders dates, highlights, line breaks and inline math', () => {
    expect(
      renderRichText(
        [{ kind: 'date', text: 'Feb 29', start: '2024-02-29', end: null, annotations: base }],
        resolve,
      ),
    ).toBe('<time datetime="2024-02-29">Feb 29</time>');
    expect(renderRichText([span('mark', { color: 'yellow_background' })], resolve)).toBe(
      '<span class="hl-yellow">mark</span>',
    );
    expect(renderRichText([span('a\nb')], resolve)).toBe('a<br>b');
    expect(
      renderRichText([{ kind: 'equation', expression: 'x^2', annotations: base }], resolve),
    ).toContain('class="katex"');
  });
});

describe('renderCell', () => {
  it('renders each cell kind', () => {
    expect(renderCell(undefined, resolve)).toBe('');
    expect(renderCell({ kind: 'empty' }, resolve)).toBe('');
    expect(renderCell({ kind: 'stars', value: 4 }, resolve)).toBe(
      '<span class="stars" role="img" aria-label="4 out of 5">★★★★☆</span>',
    );
    expect(renderCell({ kind: 'chips', values: [{ name: 'Drama', color: 'blue' }] }, resolve)).toBe(
      '<span class="chip c-blue">Drama</span>',
    );
    expect(renderCell({ kind: 'date', start: '2023-10-21', end: null }, resolve)).toBe(
      '<time datetime="2023-10-21">2023-10-21</time>',
    );
    expect(renderCell({ kind: 'url', url: 'https://www.imdb.com/title/tt0108052/' }, resolve)).toBe(
      '<a href="https://www.imdb.com/title/tt0108052/" rel="noopener noreferrer">imdb.com</a>',
    );
    expect(renderCell({ kind: 'checkbox', value: true }, resolve)).toContain('✓');
    expect(renderCell({ kind: 'number', value: 1993 }, resolve)).toBe('1993');
  });
});

describe('format helpers', () => {
  it('formats bytes and hostnames', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(hostnameOf('https://www.example.com/a')).toBe('example.com');
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});
