import { describe, expect, it } from 'vitest';
import {
  collectHeadings,
  collectLinkedPageIds,
  collectMediaKeys,
  collectPlainText,
  excerpt,
  firstImageId,
  firstParagraph,
  hasMath,
  readingMinutes,
} from '../../src/notion/text';
import type { Annotations, MediaRef, Node, RichText } from '../../src/notion/types';

const plainAnnotations: Annotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
};
const text = (value: string, pageId: string | null = null): RichText => [
  { kind: 'text', text: value, annotations: plainAnnotations, href: null, pageId },
];
const media = (key: string): MediaRef => ({
  key,
  kind: 'image',
  mime: 'image/png',
  bytes: 1,
  fileName: 'a.png',
  src: '/_media/a',
  width: 1,
  height: 1,
  variants: [],
  dominant: null,
});

const nodes: Node[] = [
  {
    type: 'heading',
    id: 'h',
    level: 2,
    text: text('Intro'),
    anchor: 'intro',
    color: 'default',
    toggleable: false,
    children: [],
  },
  { type: 'paragraph', id: 'p0', text: [], color: 'default', children: [] },
  {
    type: 'paragraph',
    id: 'p1',
    text: text('First paragraph links to a page.', 'a'.repeat(32)),
    color: 'default',
    children: [],
  },
  {
    type: 'list',
    id: 'l',
    style: 'bulleted',
    items: [
      {
        id: 'i',
        text: text('item'),
        color: 'default',
        checked: null,
        children: [{ type: 'image', id: 'img', media: media('img-key'), caption: [], alt: '' }],
      },
    ],
  },
  {
    type: 'code',
    id: 'c',
    language: 'ts',
    code: 'const ignored = true',
    caption: [],
    frame: 'none',
    title: null,
  },
  {
    type: 'paragraph',
    id: 'p2',
    text: [{ kind: 'equation', expression: 'x^2', annotations: plainAnnotations }],
    color: 'default',
    children: [],
  },
  { type: 'page_link', id: 'pl', pageId: 'b'.repeat(32), title: '' },
  {
    type: 'database',
    id: 'd',
    title: 'Movies',
    columns: [],
    rows: [
      {
        id: 'r',
        cells: {
          poster: { kind: 'media', items: [media('poster-key')] },
          title: { kind: 'text', text: text('Strays') },
        },
      },
    ],
  },
];

describe('AST helpers', () => {
  it('collects prose, headings, media, links and math', () => {
    expect(collectPlainText(nodes)).toBe('Intro\nFirst paragraph links to a page.\nitem\nx^2');
    expect(firstParagraph(nodes)).toBe('First paragraph links to a page.');
    expect(collectHeadings(nodes)).toEqual([{ anchor: 'intro', text: 'Intro', level: 2 }]);
    expect(collectMediaKeys(nodes).sort()).toEqual(['img-key', 'poster-key']);
    expect(collectLinkedPageIds(nodes).sort()).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
    expect(hasMath(nodes)).toBe(true);
    expect(firstImageId(nodes)).toBe('img');
  });

  it('leaves blank headings out of the table of contents but keeps the headings inside them', () => {
    const heading = (anchor: string, value: RichText, children: Node[] = []): Node => ({
      type: 'heading',
      id: anchor,
      level: 2,
      text: value,
      anchor,
      color: 'default',
      toggleable: true,
      children,
    });
    const headings = collectHeadings([
      heading('section', []),
      heading('section-1', text('  '), [heading('inside', text('Inside'))]),
    ]);
    expect(headings).toEqual([{ anchor: 'inside', text: 'Inside', level: 2 }]);
  });

  const hidden: Node[] = [
    { type: 'paragraph', id: 'hidden-p', text: text('Hidden'), color: 'default', children: [] },
    { type: 'image', id: 'hidden-img', media: media('hidden'), caption: [], alt: '' },
  ];
  const shown: Node[] = [
    { type: 'paragraph', id: 'shown-p', text: text('Shown'), color: 'default', children: [] },
    { type: 'image', id: 'shown-img', media: media('shown'), caption: [], alt: '' },
  ];

  it.each<{ name: string; collapsed: Node }>([
    {
      name: 'toggle',
      collapsed: {
        type: 'toggle',
        id: 't',
        summary: text('More'),
        color: 'default',
        children: hidden,
      },
    },
    {
      name: 'toggleable heading',
      collapsed: {
        type: 'heading',
        id: 'h',
        level: 2,
        text: text('More'),
        anchor: 'more',
        color: 'default',
        toggleable: true,
        children: hidden,
      },
    },
  ])('skips the paragraph and image collapsed in a $name', ({ collapsed }) => {
    expect(firstParagraph([collapsed, ...shown])).toBe('Shown');
    expect(firstImageId([collapsed, ...shown])).toBe('shown-img');
  });

  it('estimates reading time for English, Chinese and mixed text', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('word '.repeat(460))).toBe(2);
    expect(readingMinutes('字'.repeat(800))).toBe(2);
    expect(readingMinutes(`${'word '.repeat(230)}${'字'.repeat(400)}`)).toBe(2);
  });

  it('adds English and Chinese reading time before rounding up', () => {
    expect(readingMinutes(`${'word '.repeat(115)}${'字'.repeat(200)}`)).toBe(1);
    expect(readingMinutes('word字'.repeat(230))).toBe(2);
  });

  it('counts CJK ideographs, but not emoji or Hangul, as Chinese characters', () => {
    expect(readingMinutes('\u{1F600}'.repeat(400))).toBe(1);
    expect(readingMinutes('\u{F900}'.repeat(800))).toBe(2);
    expect(readingMinutes('\u{AC00}'.repeat(800))).toBe(1);
  });

  it('counts excerpt length in characters and never splits a surrogate pair', () => {
    expect(excerpt(`${'字'.repeat(158)}\u{1F600}\u{1F600}\u{1F600}`)).toBe(
      `${'字'.repeat(158)}\u{1F600}…`,
    );
    const emoji = '\u{1F600}'.repeat(100);
    expect(excerpt(emoji)).toBe(emoji);
    expect(excerpt(emoji).isWellFormed()).toBe(true);
  });

  it('never splits an emoji sequence at the cut', () => {
    const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
    const flag = '\u{1F1E8}\u{1F1F3}';
    expect(excerpt(`${'字'.repeat(158)}${family}${flag}字`)).toBe(`${'字'.repeat(158)}${family}…`);
    expect(excerpt(`${'字'.repeat(158)}${flag}${family}字`)).toBe(`${'字'.repeat(158)}${flag}…`);
  });

  it('keeps an excerpt within a short limit, ellipsis included', () => {
    expect(excerpt('字'.repeat(50), 10)).toBe(`${'字'.repeat(9)}…`);
    expect(excerpt('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('keeps a word that ends exactly at the cut', () => {
    expect(excerpt('aaaa bbbb cccc dddd', 10)).toBe('aaaa bbbb…');
  });

  it('backs off to a space only when the cut splits a Latin word', () => {
    expect(excerpt('aaaa bbbb cccc dddd', 12)).toBe('aaaa bbbb…');
    expect(excerpt(`${'我'.repeat(140)} Astro ${'字'.repeat(40)}`)).toBe(
      `${'我'.repeat(140)} Astro ${'字'.repeat(12)}…`,
    );
  });

  it('cuts excerpts at a word boundary', () => {
    expect(excerpt('short text')).toBe('short text');
    const long =
      'Douban is one of the earliest social media platforms in China, it is simple and oldschool. Although it is no longer popular, it still carries some cyber data.';
    const result = excerpt(long, 80);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toMatch(/\s…$/);
  });
});
