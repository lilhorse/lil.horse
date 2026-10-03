import { describe, expect, it } from 'vitest';
import Blocks from '../../src/components/blocks/Blocks.astro';
import BookmarkCard from '../../src/components/blocks/BookmarkCard.astro';
import FileCard from '../../src/components/blocks/FileCard.astro';
import Picture from '../../src/components/blocks/Picture.astro';
import VideoBlock from '../../src/components/blocks/VideoBlock.astro';
import type { LinkResolver } from '../../src/lib/html';
import type {
  BookmarkMeta,
  BookmarkNode,
  MediaRef,
  Node,
  NotionColor,
  RichText,
  VideoNode,
} from '../../src/notion/types';
import { htmlErrors, render, textOf } from '../helpers/astro-render';

const resolve: LinkResolver = (pageId) =>
  pageId === 'known' ? { url: '/blog/known', title: 'Known post' } : undefined;

const text = (value: string): RichText => [
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
    href: null,
    pageId: null,
  },
];

const media = (key: string, overrides: Partial<MediaRef> = {}): MediaRef => ({
  key,
  kind: 'image',
  mime: 'image/png',
  bytes: 1024,
  fileName: 'a.png',
  src: `/_media/${key}/a.png`,
  width: 640,
  height: 480,
  variants: [
    { width: 480, format: 'avif', src: `/_media/${key}/480.avif` },
    { width: 480, format: 'webp', src: `/_media/${key}/480.webp` },
  ],
  dominant: null,
  ...overrides,
});

const bookmark = (url: string, meta: BookmarkMeta | null = null): BookmarkNode => ({
  type: 'bookmark',
  id: 'b',
  url,
  meta,
  caption: [],
});

const meta: BookmarkMeta = {
  title: 'A post',
  description: 'What it says',
  siteName: 'Example Site',
  image: null,
  icon: null,
};

const videoLink = (url: string): VideoNode => ({
  type: 'video',
  id: 'v',
  source: { kind: 'link', url },
  caption: [],
});

describe('href policy', () => {
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(2)'])(
    'renders a bookmark to %s without a link target',
    async (url) => {
      for (const node of [bookmark(url), bookmark(url, meta)]) {
        const html = await render(BookmarkCard, { node, resolve });
        expect(html).not.toMatch(/\shref=/);
        expect(html).not.toMatch(/\srel=/);
        expect(await htmlErrors(html)).toEqual([]);
      }
    },
  );

  it('renders a video link to an unsafe URL as plain text', async () => {
    const html = await render(VideoBlock, { node: videoLink('javascript:alert(3)'), resolve });
    expect(html).not.toContain('<a');
    expect(html).toContain('javascript:alert(3)');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('keeps safe bookmark and video links', async () => {
    const card = await render(BookmarkCard, {
      node: bookmark('https://example.com/a', meta),
      resolve,
    });
    const video = await render(VideoBlock, { node: videoLink('https://example.com/v'), resolve });
    expect(card).toContain('href="https://example.com/a" rel="noopener noreferrer"');
    expect(video).toContain('href="https://example.com/v" rel="noopener noreferrer"');
  });
});

describe('BookmarkCard', () => {
  it('renders a plain link when the metadata could not be fetched', async () => {
    const html = await render(BookmarkCard, {
      node: bookmark('https://example.com/post'),
      resolve,
    });
    expect(html).toContain(
      '<a href="https://example.com/post" rel="noopener noreferrer">https://example.com/post</a>',
    );
    expect(html).not.toContain('bookmark-title');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('shows the site name and the site icon', async () => {
    const icon = media('icon', {
      width: 32,
      height: 32,
      variants: [
        { width: 32, format: 'avif', src: '/_media/icon/32.avif' },
        { width: 32, format: 'webp', src: '/_media/icon/32.webp' },
      ],
    });
    const html = await render(BookmarkCard, {
      node: bookmark('https://www.example.com/a', { ...meta, icon }),
      resolve,
    });
    expect(html).toMatch(
      /<img class="bookmark-icon" src="\/_media\/icon\/32\.webp" alt=""[^>]* width="16" height="16"/,
    );
    expect(html).toContain('Example Site');
    expect(html).toContain('example.com');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('uses the original file of an icon without variants', async () => {
    const icon = media('ico', {
      mime: 'image/x-icon',
      fileName: 'favicon.ico',
      src: '/_media/ico/favicon.ico',
      width: null,
      height: null,
      variants: [],
    });
    const html = await render(BookmarkCard, {
      node: bookmark('https://example.com/a', { ...meta, siteName: null, icon }),
      resolve,
    });
    expect(html).toContain('src="/_media/ico/favicon.ico"');
  });

  it('separates the parts of the card with spaces', async () => {
    const html = await render(BookmarkCard, {
      node: bookmark('https://example.com/a', meta),
      resolve,
    });
    expect(textOf(html)).toBe('A post What it says Example Site example.com');
  });
});

describe('FileCard', () => {
  it('separates the file name from its size', async () => {
    const file = media('f', {
      kind: 'file',
      mime: 'application/pdf',
      bytes: 2048,
      fileName: 'report.pdf',
      src: '/_media/f/report.pdf',
      width: null,
      height: null,
      variants: [],
    });
    const html = await render(FileCard, {
      node: { type: 'file', id: 'f', media: file, name: 'report.pdf', caption: [] },
      resolve,
    });
    expect(textOf(html)).toBe('report.pdf 2.0 KB');
  });
});

describe('Picture', () => {
  it('prioritises an image that has no variants', async () => {
    const gif = media('gif', {
      mime: 'image/gif',
      fileName: 'a.gif',
      src: '/_media/gif/a.gif',
      variants: [],
    });
    const priority = await render(Picture, { media: gif, alt: 'A GIF', priority: true });
    const lazy = await render(Picture, { media: gif, alt: 'A GIF' });
    expect(priority).toContain('fetchpriority="high"');
    expect(priority).toContain('loading="eager"');
    expect(lazy).not.toContain('fetchpriority');
  });
});

describe('Blocks', () => {
  const paragraph = (color: NotionColor, children: Node[] = []): Node => ({
    type: 'paragraph',
    id: `p-${color}`,
    text: text('para'),
    color,
    children,
  });

  it('maps colours to text and highlight classes and leaves default blocks unclassed', async () => {
    const nodes: Node[] = [
      paragraph('default'),
      paragraph('gray_background'),
      {
        type: 'heading',
        id: 'h',
        level: 2,
        text: text('Heading'),
        anchor: 'heading',
        color: 'red',
        toggleable: false,
        children: [],
      },
      {
        type: 'list',
        id: 'l',
        style: 'bulleted',
        items: [
          { id: 'i1', text: text('one'), color: 'default', checked: null, children: [] },
          { id: 'i2', text: text('two'), color: 'blue_background', checked: null, children: [] },
        ],
      },
      { type: 'quote', id: 'q', text: text('quote'), color: 'default', children: [] },
      { type: 'callout', id: 'c1', icon: null, text: text('a'), color: 'default', children: [] },
      {
        type: 'callout',
        id: 'c2',
        icon: null,
        text: text('b'),
        color: 'yellow_background',
        children: [],
      },
      { type: 'toggle', id: 't1', summary: text('c'), color: 'default', children: [] },
      { type: 'toggle', id: 't2', summary: text('d'), color: 'purple', children: [] },
    ];
    const html = await render(Blocks, { nodes, resolve, headings: [] });
    expect(html).not.toMatch(/c-default|_background/);
    for (const tag of [
      '<p>',
      '<p class="hl-gray">',
      '<h2 id="heading" class="c-red">',
      '<li>',
      '<li class="hl-blue">',
      '<blockquote>',
      '<aside class="callout">',
      '<aside class="callout hl-yellow">',
      '<details class="toggle">',
      '<details class="toggle c-purple">',
    ])
      expect(html).toContain(tag);
    expect(await htmlErrors(html)).toEqual([]);
  });

  const nested: Node[] = [
    { type: 'page_link', id: 'pl', pageId: 'known', title: 'Known' },
    { type: 'toc', id: 'toc' },
    { type: 'image', id: 'img', media: media('img'), alt: 'Nested', caption: [] },
  ];
  const wrappers: Record<string, Node> = {
    paragraph: paragraph('default', nested),
    'toggleable heading': {
      type: 'heading',
      id: 'th',
      level: 3,
      text: text('Toggle heading'),
      anchor: 'toggle-heading',
      color: 'default',
      toggleable: true,
      children: nested,
    },
    'list item': {
      type: 'list',
      id: 'li',
      style: 'numbered',
      items: [
        { id: 'item', text: text('item'), color: 'default', checked: null, children: nested },
      ],
    },
    quote: { type: 'quote', id: 'q', text: text('q'), color: 'default', children: nested },
    callout: {
      type: 'callout',
      id: 'c',
      icon: null,
      text: text('c'),
      color: 'default',
      children: nested,
    },
    toggle: { type: 'toggle', id: 't', summary: text('t'), color: 'default', children: nested },
    column: {
      type: 'columns',
      id: 'cols',
      columns: [{ id: 'col', widthRatio: null, children: nested }],
    },
    container: { type: 'container', id: 'ct', children: nested },
  };

  it.each(Object.entries(wrappers))('passes its props down into a %s', async (_, wrapper) => {
    const html = await render(Blocks, {
      nodes: [wrapper],
      resolve,
      headings: [{ anchor: 'intro', text: 'Intro', level: 2 }],
      priorityImageId: 'img',
    });
    expect(html).toMatch(/<a href="\/blog\/known">.*Known post<\/a>/);
    expect(html).toContain('<a href="#intro">Intro</a>');
    expect(html).toContain('fetchpriority="high"');
  });
});
