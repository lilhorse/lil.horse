import { describe, expect, it } from 'vitest';
import Blocks from '../../src/components/blocks/Blocks.astro';
import BookmarkCard from '../../src/components/blocks/BookmarkCard.astro';
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
import { render } from '../helpers/astro-render';

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

describe('Blocks', () => {
  const paragraph = (color: NotionColor, children: Node[] = []): Node => ({
    type: 'paragraph',
    id: `p-${color}`,
    text: text('para'),
    color,
    children,
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
    expect(html).toContain('<a href="/blog/known">Known post</a>');
    expect(html).toContain('<a href="#intro">Intro</a>');
    expect(html).toContain('fetchpriority="high"');
  });
});
