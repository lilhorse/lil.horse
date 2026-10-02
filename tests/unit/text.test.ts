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

  it.each([
    "don't",
    'don\u{2019}t',
    'r\u{E9}sum\u{E9}',
    'caf\u{E9}',
    '1,000',
    '3.14',
    'well-known',
    '\u{D55C}\u{AD6D}\u{C5B4}',
  ])('keeps or drops %s whole', (word) => {
    const text = `and ${word}. More`;
    for (let kept = 1; kept < word.length; kept++)
      expect(excerpt(text, kept + 5)).toBe('and\u{2026}');
    expect(excerpt(text, word.length + 5)).toBe(`and ${word}\u{2026}`);
  });

  it('backs off to the CJK character before a glued Latin word', () => {
    const cjk = '\u{6211}'.repeat(157);
    expect(excerpt(`${cjk}Astro`)).toBe(`${cjk}\u{2026}`);
  });

  it('hard-cuts a word that starts more than 30 graphemes before the cut', () => {
    expect(excerpt(`and ${'a'.repeat(40)}`, 40)).toBe(`and ${'a'.repeat(35)}\u{2026}`);
    const cjk = '\u{6211}'.repeat(120);
    expect(excerpt(`${cjk}${'a'.repeat(60)}`)).toBe(`${cjk}${'a'.repeat(39)}\u{2026}`);
  });

  it('backs off only to a boundary less than 30 graphemes before the limit', () => {
    const word = 'a'.repeat(40);
    expect(excerpt(`${'\u{6211}'.repeat(12)}${word}`, 40)).toBe(`${'\u{6211}'.repeat(12)}\u{2026}`);
    expect(excerpt(`${'\u{6211}'.repeat(11)}${word}`, 40)).toBe(
      `${'\u{6211}'.repeat(11)}${'a'.repeat(28)}\u{2026}`,
    );
  });

  it('keeps the katakana long-vowel mark with its word', () => {
    const user = '\u{30E6}\u{30FC}\u{30B6}\u{30FC}';
    expect(excerpt(`${user}ID more`, 5)).toBe(`${user}\u{2026}`);
    expect(excerpt(`${user}ID more`, 6)).toBe(`${user}\u{2026}`);
  });

  it('drops an opening bracket or quote together with the word after it', () => {
    expect(excerpt('see (supercalifragilistic) now', 12)).toBe('see\u{2026}');
    expect(excerpt('he said "supercalifragilistic"', 14)).toBe('he said\u{2026}');
    expect(excerpt('\u{6211}\u{5728}\u{300A}Hacker News\u{300B}', 6)).toBe(
      '\u{6211}\u{5728}\u{2026}',
    );
  });

  it.each([
    ['I built it with Notion/', 'Astro', 'I built it with Notion'],
    ['Thanks to @', 'supercalifragilistic', 'Thanks to'],
    ['I tagged it #', 'webdevelopment', 'I tagged it'],
    ['It costs $', '1,000', 'It costs'],
    ['It was -', '15', 'It was'],
    ['I like Astro\u{2014}', 'the', 'I like Astro'],
    ['Read it at https://', 'lil.horse', 'Read it at https'],
    ['\u{6807}\u{7B7E}\u{662F}#', 'webdevelopment', '\u{6807}\u{7B7E}\u{662F}'],
    ['I wrapped it in $(', 'date', 'I wrapped it in'],
    ['\u{4ED6}\u{8BF4}\u{2014}\u{2014}\u{201C}', 'Astro', '\u{4ED6}\u{8BF4}'],
    ['Run "/', 'usr', 'Run'],
    ['He replied "@', 'supercalifragilistic', 'He replied'],
    ['Open C:\\Users\\', 'lilhorse', 'Open C:\\Users'],
  ])('drops the punctuation glued to the front of a cut word in %s%s', (before, word, kept) => {
    const text = `${before}${word} and more`;
    for (let cut = 1; cut < word.length; cut++)
      expect(excerpt(text, before.length + cut + 1)).toBe(`${kept}\u{2026}`);
  });

  it.each([
    ['I moved the backend to (.', 'NET', 'I moved the backend to'],
    ['\u{6700}\u{8FD1}\u{5728}\u{8BFB}\u{300A}', 'Designing', '\u{6700}\u{8FD1}\u{5728}\u{8BFB}'],
    ['He said \u{201C}', 'word', 'He said'],
    ['\u{7136}\u{540E}\u{2026}\u{2026}', 'Astro', '\u{7136}\u{540E}'],
  ])('trims openers and ellipses off the end of %s%s', (before, word, kept) => {
    const text = `${before}${word} and more`;
    for (let cut = 0; cut < word.length; cut++)
      expect(excerpt(text, before.length + cut + 1)).toBe(`${kept}\u{2026}`);
  });

  it('trims a slash or @ left right before the cut', () => {
    expect(excerpt('I built it with Notion/Astro today', 24)).toBe(
      'I built it with Notion\u{2026}',
    );
    expect(excerpt('Thanks to @supercalifragilistic', 12)).toBe('Thanks to\u{2026}');
  });

  it('keeps words joined by a slash when the cut lands right after them', () => {
    const text = '\u{6211}\u{7528}\u{4E86}Notion/Astro\u{642D}\u{5EFA}\u{535A}\u{5BA2}';
    expect(excerpt(text, 16)).toBe('\u{6211}\u{7528}\u{4E86}Notion/Astro\u{2026}');
  });

  it('keeps the # of C# when the cut lands right after it', () => {
    expect(excerpt('I write C# daily', 11)).toBe('I write C#\u{2026}');
    expect(excerpt('I write C# daily', 12)).toBe('I write C#\u{2026}');
  });

  it('never trims part of a grapheme off the end', () => {
    const text = 'Total: \u{0600}. That is all';
    expect(excerpt(text, 9)).toBe('Total: \u{0600}.\u{2026}');
    expect(excerpt(text, 10)).toBe('Total: \u{0600}.\u{2026}');
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
