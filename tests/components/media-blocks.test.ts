import { describe, expect, it } from 'vitest';
import DatabaseTable from '../../src/components/blocks/DatabaseTable.astro';
import Equation from '../../src/components/blocks/Equation.astro';
import VideoBlock from '../../src/components/blocks/VideoBlock.astro';
import type { LinkResolver } from '../../src/lib/html';
import type { DatabaseNode, RichText, VideoSource } from '../../src/notion/types';
import { htmlErrors, render } from '../helpers/astro-render';

const resolve: LinkResolver = () => undefined;
const caption = (value: string): RichText => [
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

describe('VideoBlock', () => {
  it('renders YouTube as a link that the facade script turns into a player', async () => {
    const html = await render(VideoBlock, {
      node: {
        type: 'video',
        id: 'v',
        source: { kind: 'youtube', videoId: 'abc_DEF-123', poster: null },
        caption: caption('A talk'),
      },
      resolve,
    });
    expect(html).toContain(
      '<a class="youtube" href="https://www.youtube.com/watch?v=abc_DEF-123" rel="noopener noreferrer" data-youtube="abc_DEF-123" data-title="A talk">',
    );
    expect(html).toContain('<span class="sr-only">Play video: A talk</span>');
    expect(html).toMatch(/<script type="module" src="[^"]*YouTubeFacadeScript[^"]*"><\/script>/);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('titles a Vimeo frame after its caption', async () => {
    const html = await render(VideoBlock, {
      node: {
        type: 'video',
        id: 'v',
        source: { kind: 'vimeo', videoId: '1', hash: null },
        caption: caption('Demo'),
      },
      resolve,
    });
    expect(html).toContain('title="Demo"');
  });

  it.each<VideoSource>([
    { kind: 'vimeo', videoId: '1', hash: null },
    {
      kind: 'file',
      media: {
        key: 'clip',
        kind: 'file',
        mime: 'video/mp4',
        bytes: 1024,
        fileName: 'clip.mp4',
        src: '/_media/clip/clip.mp4',
        width: null,
        height: null,
        variants: [],
        dominant: null,
      },
    },
    { kind: 'link', url: 'https://example.com/v' },
  ])('ships no script with a $kind video', async (source) => {
    const html = await render(VideoBlock, {
      node: { type: 'video', id: 'v', source, caption: [] },
      resolve,
    });
    expect(html).not.toContain('<script');
  });
});

describe('DatabaseTable', () => {
  const node: DatabaseNode = {
    type: 'database',
    id: 'db',
    title: 'Watched Movies',
    columns: [
      { id: 't', name: 'Title', type: 'title', format: null },
      { id: 'r', name: 'Rating', type: 'multi_select', format: 'stars' },
      { id: 'd', name: 'Rated', type: 'date', format: null },
    ],
    rows: Array.from({ length: 11 }, (_, index) => ({
      id: `r${index}`,
      cells: {
        t: { kind: 'text', text: caption(`Movie ${index}`) },
        r: { kind: 'stars', value: 4 },
        d: { kind: 'date', start: '2023-10-21', end: null },
      },
    })),
  };

  it('scrolls inside focusable regions named after the table and classes its columns', async () => {
    const html = await render(DatabaseTable, { node, resolve });
    expect(
      html.match(
        /<div class="table-scroll" tabindex="0" role="group" aria-label="Watched Movies">/g,
      ),
    ).toHaveLength(2);
    expect(html).toContain(
      '<td class="stars"><span class="stars" role="img" aria-label="4 out of 5">★★★★☆</span></td>',
    );
    expect(html).toContain('<td class="date"><time datetime="2023-10-21">2023-10-21</time></td>');
    expect(html).toContain('<summary>Show all 11 rows</summary>');
    expect(await htmlErrors(html)).toEqual([]);
  });
});

describe('Equation', () => {
  it('scrolls a wide display equation inside a focusable group', async () => {
    const html = await render(Equation, { expression: 'x^2' });
    expect(html).toMatch(
      /^<div class="equation" tabindex="0" role="group" aria-label="Equation"><span class="katex-display">/,
    );
  });
});
