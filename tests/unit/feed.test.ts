import { describe, expect, it } from 'vitest';
import { absolutizeHtml, feedContent, feedItems, renderFeedNodes } from '../../src/lib/feed';
import type { LinkResolver } from '../../src/lib/html';
import type { MediaRef, Node, RichText } from '../../src/notion/types';
import { post } from '../helpers/site-data';

const resolve: LinkResolver = (pageId) =>
  pageId === 'known' ? { url: '/blog/known', title: 'Known post' } : undefined;

const text = (value: string, href: string | null = null): RichText => [
  {
    kind: 'text',
    text: value,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    href,
    pageId: null,
  },
];

const media = (key: string): MediaRef => ({
  key,
  kind: 'image',
  mime: 'image/png',
  bytes: 2048,
  fileName: 'a.png',
  src: `/_media/${key}/a.png`,
  width: 640,
  height: 480,
  variants: [
    { width: 480, format: 'avif', src: `/_media/${key}/480.avif` },
    { width: 480, format: 'webp', src: `/_media/${key}/480.webp` },
    { width: 960, format: 'webp', src: `/_media/${key}/960.webp` },
  ],
  dominant: null,
});

const render = (nodes: Node[]) => renderFeedNodes(nodes, { resolve });

describe('renderFeedNodes', () => {
  it('renders text blocks as plain semantic HTML', () => {
    const nodes: Node[] = [
      { type: 'paragraph', id: 'p', text: text('Hi'), color: 'default', children: [] },
      {
        type: 'heading',
        id: 'h',
        level: 2,
        text: text('Title'),
        anchor: 'title',
        color: 'default',
        toggleable: false,
        children: [],
      },
      {
        type: 'list',
        id: 'l',
        style: 'todo',
        items: [
          { id: 'a', text: text('done'), color: 'default', checked: true, children: [] },
          { id: 'b', text: text('open'), color: 'default', checked: false, children: [] },
        ],
      },
      { type: 'quote', id: 'q', text: text('Quote'), color: 'default', children: [] },
      {
        type: 'callout',
        id: 'c',
        icon: { kind: 'emoji', emoji: '💡' },
        text: text('Note'),
        color: 'gray_background',
        children: [],
      },
      { type: 'toggle', id: 't', summary: text('More'), color: 'default', children: [] },
      { type: 'divider', id: 'd' },
      { type: 'toc', id: 'toc' },
      { type: 'unsupported', id: 'u', blockType: 'breadcrumb' },
      { type: 'page_link', id: 'pl', pageId: 'known', title: 'Known post' },
      { type: 'page_link', id: 'pl2', pageId: 'gone', title: 'Gone' },
    ];
    expect(render(nodes)).toBe(
      '<p>Hi</p><h2>Title</h2><ul><li>☑ done</li><li>☐ open</li></ul><blockquote><p>Quote</p></blockquote>' +
        '<aside><p>💡 Note</p></aside><details><summary>More</summary></details><hr><p><a href="/blog/known">Known post</a></p>',
    );
  });

  it('renders code as escaped text, math as MathML and media as plain elements', () => {
    const nodes: Node[] = [
      {
        type: 'code',
        id: 'c',
        language: 'ts',
        code: 'const a = "<b>";',
        caption: text('snippet'),
        frame: 'editor',
        title: 'a.ts',
      },
      { type: 'equation', id: 'e', expression: 'x^2' },
      { type: 'image', id: 'i', media: media('k'), caption: text('A cat'), alt: 'Cat' },
      {
        type: 'video',
        id: 'v',
        source: { kind: 'youtube', videoId: 'abc', poster: null },
        caption: text('Talk'),
      },
      { type: 'file', id: 'f', media: media('f'), name: 'notes.pdf', caption: [] },
      {
        type: 'bookmark',
        id: 'b',
        url: 'https://example.com',
        meta: { title: 'Example', description: 'A site', siteName: null, image: null, icon: null },
        caption: [],
      },
    ];
    const html = render(nodes);
    expect(html).toContain(
      '<figure><pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot;;</code></pre><figcaption>snippet</figcaption></figure>'.replace(
        /&quot;/g,
        '"',
      ),
    );
    expect(html).toContain('<math');
    expect(html).not.toContain('katex-html');
    expect(html).toContain(
      '<figure><img src="/_media/k/960.webp" alt="Cat" width="640" height="480"><figcaption>A cat</figcaption></figure>',
    );
    expect(html).toContain(
      '<p><a href="https://www.youtube.com/watch?v=abc" rel="noopener noreferrer">Watch on YouTube: Talk</a></p>',
    );
    expect(html).toContain('<p><a href="/_media/f/a.png">notes.pdf</a> (2.0 KB)</p>');
    expect(html).toContain(
      '<p><a href="https://example.com" rel="noopener noreferrer">Example</a> — A site</p>',
    );
  });

  it('renders tables, inline databases in full and flattens columns', () => {
    const nodes: Node[] = [
      {
        type: 'table',
        id: 't',
        columnHeader: true,
        rowHeader: false,
        rows: [
          [text('Name'), text('Year')],
          [text('Alpha'), text('2024')],
        ],
      },
      {
        type: 'database',
        id: 'db',
        title: 'Watched',
        columns: [{ id: 'n', name: 'Film', type: 'title', format: null }],
        rows: Array.from({ length: 12 }, (_, index) => ({
          id: `r${index}`,
          cells: { n: { kind: 'text' as const, text: text(`Film ${index}`) } },
        })),
      },
      {
        type: 'columns',
        id: 'cols',
        columns: [
          {
            id: 'c1',
            widthRatio: 0.5,
            children: [
              { type: 'paragraph', id: 'p1', text: text('Left'), color: 'default', children: [] },
            ],
          },
          {
            id: 'c2',
            widthRatio: 0.5,
            children: [
              { type: 'paragraph', id: 'p2', text: text('Right'), color: 'default', children: [] },
            ],
          },
        ],
      },
    ];
    const html = render(nodes);
    expect(html).toContain(
      '<table><thead><tr><th scope="col">Name</th><th scope="col">Year</th></tr></thead><tbody><tr><td>Alpha</td><td>2024</td></tr></tbody></table>',
    );
    expect(html).toContain(
      '<figure><figcaption>Watched</figcaption><table><thead><tr><th scope="col">Film</th>',
    );
    expect(html.match(/<td>Film \d+<\/td>/g)).toHaveLength(12);
    expect(html).toContain('<p>Left</p><p>Right</p>');
  });

  it('keeps the hash that an unlisted Vimeo video needs', () => {
    const html = render([
      {
        type: 'video',
        id: 'v',
        source: { kind: 'vimeo', videoId: '76979871', hash: 'a1b2c3' },
        caption: [],
      },
    ]);
    expect(html).toBe(
      '<p><a href="https://vimeo.com/76979871/a1b2c3" rel="noopener noreferrer">Watch on Vimeo</a></p>',
    );
  });
});

describe('absolutizeHtml', () => {
  it('resolves site, fragment and relative addresses against the post URL', () => {
    const html =
      '<a href="/blog/x">a</a><a href="#top">b</a><img src="/_media/k/480.webp" srcset="/_media/k/480.webp 480w, /_media/k/960.webp 960w"><a href="https://example.com/">c</a><a href="mailto:a@b.c">d</a>';
    expect(absolutizeHtml(html, 'https://lil.horse/blog/post')).toBe(
      '<a href="https://lil.horse/blog/x">a</a><a href="https://lil.horse/blog/post#top">b</a><img src="https://lil.horse/_media/k/480.webp" srcset="https://lil.horse/_media/k/480.webp 480w, https://lil.horse/_media/k/960.webp 960w"><a href="https://example.com/">c</a><a href="mailto:a@b.c">d</a>',
    );
  });

  it('leaves text that only looks like an attribute alone', () => {
    const html = render([
      {
        type: 'code',
        id: 'c',
        language: 'html',
        code: '<a href="/about"><img src="/me.png"></a>',
        caption: [],
        frame: 'editor',
        title: null,
      },
      { type: 'paragraph', id: 'p', text: text('Write src="/x".'), color: 'default', children: [] },
    ]);
    expect(absolutizeHtml(html, 'https://lil.horse/blog/post')).toBe(html);
  });
});

describe('feedItems', () => {
  it('takes the newest Published posts with full content and tags, up to the limit', () => {
    const posts = Array.from({ length: 25 }, (_, index) =>
      post(`p${index}`, {
        published: `2024-01-${String(index + 1).padStart(2, '0')}`,
        tags: ['AI'],
        content: {
          ...post('x').content,
          blocks: [
            {
              type: 'paragraph',
              id: 'p',
              text: text('See', '/blog/other'),
              color: 'default',
              children: [],
            },
          ],
        },
      }),
    );
    posts.push(post('hidden', { status: 'Unlisted', published: '2024-12-31' }));
    posts.push(post('draft', { status: 'Draft', published: '2024-12-30' }));
    const items = feedItems({ posts, resolve }, 'https://lil.horse');
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({
      title: 'Post p24',
      link: '/blog/p24',
      pubDate: new Date('2024-01-25'),
      description: 'About it',
      categories: ['AI'],
      content: '<p><a href="https://lil.horse/blog/other">See</a></p>',
    });
    expect(items.map((item) => item.link)).not.toContain('/blog/hidden');
    expect(items.at(-1)?.link).toBe('/blog/p5');
  });

  it('leaves out an empty description', () => {
    const items = feedItems(
      { posts: [post('a', { description: '' })], resolve },
      'https://lil.horse',
    );
    expect(items[0]).not.toHaveProperty('description');
    expect(feedContent(post('a'), resolve, 'https://lil.horse')).toBe('');
  });
});
