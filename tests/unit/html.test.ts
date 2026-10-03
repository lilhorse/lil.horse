import { describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  hostnameOf,
  relFor,
  renderCell,
  renderRichText,
  toneClass,
} from '../../src/lib/html';
import type { Annotations, MediaRef, RichTextSpan } from '../../src/notion/types';

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

  it('treats only single-slash paths as site-relative', () => {
    expect(renderRichText([span('a', {}, { href: '/blog/x' })], resolve)).toBe(
      '<a href="/blog/x">a</a>',
    );
    expect(renderRichText([span('b', {}, { href: '//evil.example/x' })], resolve)).toBe('b');
    expect(renderRichText([span('c', {}, { href: '/\\evil.example/x' })], resolve)).toBe('c');
    expect(renderRichText([span('d', {}, { href: '/\n/evil.example/x' })], resolve)).toBe('d');
    expect(renderRichText([span('e', {}, { href: '/\t/evil.example/x' })], resolve)).toBe('e');
    expect(renderRichText([span('f', {}, { href: '/\r/evil.example/x' })], resolve)).toBe('f');
  });

  it('links a resolved page to its site URL, whatever its href', () => {
    expect(
      renderRichText(
        [span('post', {}, { pageId: HELLO, href: `https://www.notion.so/${HELLO}` })],
        resolve,
      ),
    ).toBe('<a href="/blog/helloworld">post</a>');
  });

  it('merges neighbouring spans that link to the same place', () => {
    expect(
      renderRichText(
        [
          span('Read ', {}, { href: 'https://docs.example' }),
          span('the docs', { bold: true }, { href: 'https://docs.example' }),
          span(' now'),
        ],
        resolve,
      ),
    ).toBe(
      '<a href="https://docs.example" rel="noopener noreferrer">Read <strong>the docs</strong></a> now',
    );
    expect(
      renderRichText(
        [
          span('a', {}, { pageId: HELLO }),
          span('b', { italic: true }, { href: '/blog/helloworld' }),
        ],
        resolve,
      ),
    ).toBe('<a href="/blog/helloworld">a<em>b</em></a>');
  });

  it('keeps neighbouring links to different places apart', () => {
    expect(
      renderRichText(
        [
          span('one', {}, { href: 'https://a.example' }),
          span('two', {}, { href: 'https://b.example' }),
        ],
        resolve,
      ),
    ).toBe(
      '<a href="https://a.example" rel="noopener noreferrer">one</a><a href="https://b.example" rel="noopener noreferrer">two</a>',
    );
  });

  it('adds rel only to external web links', () => {
    expect(renderRichText([span('top', {}, { href: '#intro' })], resolve)).toBe(
      '<a href="#intro">top</a>',
    );
    expect(renderRichText([span('mail', {}, { href: 'mailto:a@b.c' })], resolve)).toBe(
      '<a href="mailto:a@b.c">mail</a>',
    );
    expect(renderRichText([span('web', {}, { href: 'HTTP://x.example' })], resolve)).toBe(
      '<a href="HTTP://x.example" rel="noopener noreferrer">web</a>',
    );
  });

  it('escapes quotes in attributes', () => {
    expect(renderRichText([span('x', {}, { href: '/a" onmouseover="b' })], resolve)).toBe(
      '<a href="/a&quot; onmouseover=&quot;b">x</a>',
    );
    expect(
      renderRichText(
        [{ kind: 'date', text: 'Feb 29', start: '2024-02-29"', end: null, annotations: base }],
        resolve,
      ),
    ).toBe('<time datetime="2024-02-29&quot;">Feb 29</time>');
    expect(
      renderRichText([span('x', {}, { pageId: HELLO })], () => ({ url: '/a"b', title: '' })),
    ).toBe('<a href="/a&quot;b">x</a>');
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

  it('renders CJK in math without strict-mode warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const html = renderRichText(
        [{ kind: 'equation', expression: '速度 = \\frac{距离}{时间}', annotations: base }],
        resolve,
      );
      expect(html).toContain('<math');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('still warns about other strict-mode issues in math', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderRichText([{ kind: 'equation', expression: 'x%', annotations: base }], resolve);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[commentAtEnd]'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('toneClass', () => {
  it('gives the default text and background colours no class', () => {
    expect(toneClass('default')).toBeUndefined();
    expect(toneClass('default_background')).toBeUndefined();
    expect(toneClass('gray_background')).toBe('hl-gray');
    expect(toneClass('red')).toBe('c-red');
    expect(renderRichText([span('plain', { color: 'default_background' })], resolve)).toBe('plain');
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
    expect(
      renderCell({ kind: 'chips', values: [{ name: 'Plain', color: 'default' }] }, resolve),
    ).toBe('<span class="chip">Plain</span>');
    expect(renderCell({ kind: 'date', start: '2023-10-21', end: null }, resolve)).toBe(
      '<time datetime="2023-10-21">2023-10-21</time>',
    );
    expect(renderCell({ kind: 'url', url: 'https://www.imdb.com/title/tt0108052/' }, resolve)).toBe(
      '<a href="https://www.imdb.com/title/tt0108052/" rel="noopener noreferrer">imdb.com</a>',
    );
    expect(renderCell({ kind: 'checkbox', value: true }, resolve)).toContain('✓');
    expect(renderCell({ kind: 'number', value: 1993 }, resolve)).toBe('1993');
  });

  it('keeps a visible label for mailto and tel links', () => {
    expect(hostnameOf('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(renderCell({ kind: 'url', url: 'tel:+123' }, resolve)).toBe(
      '<a href="tel:+123">tel:+123</a>',
    );
  });

  it('renders unsafe urls as escaped text', () => {
    expect(renderCell({ kind: 'url', url: 'javascript:alert(1)//<b>' }, resolve)).toBe(
      'javascript:alert(1)//&lt;b&gt;',
    );
  });

  it('renders media as lazy thumbnails', () => {
    const media: MediaRef = {
      key: 'k',
      kind: 'image',
      mime: 'image/png',
      bytes: 1,
      fileName: 'a".png',
      src: '/_media/k/a".png',
      width: 1200,
      height: 800,
      variants: [],
      dominant: null,
    };
    expect(renderCell({ kind: 'media', items: [media] }, resolve)).toBe(
      '<img src="/_media/k/a&quot;.png" alt="" width="64" height="43" loading="lazy" decoding="async">',
    );
  });

  it('escapes quotes in attributes', () => {
    expect(renderCell({ kind: 'url', url: 'https://example.com/"' }, resolve)).toBe(
      '<a href="https://example.com/&quot;" rel="noopener noreferrer">example.com</a>',
    );
    expect(renderCell({ kind: 'date', start: '2023"', end: '2024"' }, resolve)).toBe(
      '<time datetime="2023&quot;">2023"</time> → <time datetime="2024&quot;">2024"</time>',
    );
  });
});

describe('relFor', () => {
  it('judges the URL the browser will follow, as isSafeHref does', () => {
    expect(relFor('ht\ttps://x.example')).toBe('noopener noreferrer');
    expect(relFor('/\n/evil.example')).toBe('noopener noreferrer');
    expect(relFor('/\\evil.example')).toBe('noopener noreferrer');
    expect(renderRichText([span('x', {}, { href: 'ht\ttps://x.example' })], resolve)).toBe(
      '<a href="ht\ttps://x.example" rel="noopener noreferrer">x</a>',
    );
    expect(renderCell({ kind: 'url', url: 'ht\ttps://x.example' }, resolve)).toBe(
      '<a href="ht\ttps://x.example" rel="noopener noreferrer">x.example</a>',
    );
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

  it('moves to the next unit instead of printing 1024 of one', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048063)).toBe('1023 KB');
    expect(formatBytes(1048064)).toBe('1.0 MB');
    expect(formatBytes(1048575)).toBe('1.0 MB');
    expect(formatBytes(1073217535)).toBe('1023 MB');
    expect(formatBytes(1073217536)).toBe('1.0 GB');
  });

  it('shows internationalized hostnames in Unicode', () => {
    expect(hostnameOf('https://例子.测试/x')).toBe('例子.测试');
  });
});
