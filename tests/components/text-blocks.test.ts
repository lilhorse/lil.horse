import { describe, expect, it } from 'vitest';
import Blocks from '../../src/components/blocks/Blocks.astro';
import type { LinkResolver } from '../../src/lib/html';
import type { Node, RichText } from '../../src/notion/types';
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

const blocks = (nodes: Node[]) => render(Blocks, { nodes, resolve, headings: [] });

describe('text blocks', () => {
  it('marks h2 headings with a ## that screen readers and search skip, and leaves deeper ones bare', async () => {
    const html = await blocks([
      {
        type: 'heading',
        id: 'a',
        level: 2,
        text: text('Movies'),
        anchor: 'movies',
        color: 'default',
        toggleable: false,
        children: [],
      },
      {
        type: 'heading',
        id: 'b',
        level: 3,
        text: text('Ratings'),
        anchor: 'ratings',
        color: 'default',
        toggleable: false,
        children: [],
      },
    ]);
    expect(html).toContain(
      '<h2 id="movies"><span class="heading-mark" aria-hidden="true" data-pagefind-ignore>##</span> Movies</h2>',
    );
    expect(html).toContain('<h3 id="ratings">Ratings</h3>');
  });

  it('puts the children of a toggle heading in a toggle body', async () => {
    const html = await blocks([
      {
        type: 'heading',
        id: 'h',
        level: 3,
        text: text('More'),
        anchor: 'more',
        color: 'default',
        toggleable: true,
        children: [
          { type: 'paragraph', id: 'p', text: text('inside'), color: 'default', children: [] },
        ],
      },
    ]);
    expect(html).toContain(
      '<details class="toggle-heading"><summary><h3 id="more">More</h3></summary><div class="toggle-body"><p>inside</p></div></details>',
    );
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('wraps a simple table in a focusable scroll region', async () => {
    const html = await blocks([
      {
        type: 'table',
        id: 't',
        columnHeader: true,
        rowHeader: true,
        rows: [
          [text('k'), text('v')],
          [text('a'), text('1')],
        ],
      },
    ]);
    expect(html).toContain(
      '<div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>',
    );
    expect(html).toContain('<th scope="row">a</th><td>1</td>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('gives callouts their highlighter stripe class and keeps the icon', async () => {
    const html = await blocks([
      {
        type: 'callout',
        id: 'c',
        icon: { kind: 'emoji', emoji: '💡' },
        text: text('note'),
        color: 'gray_background',
        children: [],
      },
    ]);
    expect(html).toContain(
      '<aside class="callout hl-gray"><span class="icon" aria-hidden="true">💡</span><div class="callout-body"><p>note</p></div></aside>',
    );
  });

  it('renders columns, a page link card and the inline table of contents', async () => {
    const html = await render(Blocks, {
      nodes: [
        {
          type: 'columns',
          id: 'cs',
          columns: [
            { id: 'c1', widthRatio: 0.25, children: [] },
            { id: 'c2', widthRatio: 0.75, children: [] },
          ],
        },
        { type: 'page_link', id: 'pl', pageId: 'known', title: 'Fallback' },
        { type: 'toc', id: 'toc' },
      ],
      resolve,
      headings: [{ anchor: 'intro', text: 'Intro', level: 2 }],
    });
    expect(html).toContain('<div class="column" style="--column-ratio: 0.25">');
    expect(textOf(html)).toContain('» Known post');
    expect(html).toContain(
      '<nav class="toc" aria-label="Table of contents"><ol><li class="toc-2"><a href="#intro">Intro</a></li></ol></nav>',
    );
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('renders a divider and an audio player with its caption', async () => {
    const html = await blocks([
      { type: 'divider', id: 'd' },
      {
        type: 'audio',
        id: 'a',
        media: {
          key: 'a',
          kind: 'file',
          mime: 'audio/mpeg',
          bytes: 1024,
          fileName: 'theme.mp3',
          src: '/_media/a/theme.mp3',
          width: null,
          height: null,
          variants: [],
          dominant: null,
        },
        caption: text('Theme song'),
      },
    ]);
    expect(html).toContain(
      '<hr><figure class="audio"><audio controls preload="none" src="/_media/a/theme.mp3"></audio><figcaption>Theme song</figcaption></figure>',
    );
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('hides unsupported blocks outside development', async () => {
    const html = await blocks([{ type: 'unsupported', id: 'u', blockType: 'meeting_notes' }]);
    expect(html.includes('Unsupported Notion block')).toBe(import.meta.env.DEV);
  });
});
