import { describe, expect, it } from 'vitest';
import { hasToc, tocTree, type TocItem } from '../../src/lib/toc';
import type { HeadingRef } from '../../src/notion/types';

const h = (level: HeadingRef['level'], text: string): HeadingRef => ({
  level,
  text,
  anchor: text.toLowerCase(),
});
const shape = (items: TocItem[]): unknown[] =>
  items.map((item) => (item.children.length ? [item.text, shape(item.children)] : item.text));

describe('tocTree', () => {
  it('nests deeper headings under the previous shallower one', () => {
    expect(shape(tocTree([h(2, 'A'), h(3, 'A1'), h(3, 'A2'), h(2, 'B')]))).toEqual([
      ['A', ['A1', 'A2']],
      'B',
    ]);
  });

  it('nests a skipped level one step below its parent', () => {
    expect(shape(tocTree([h(2, 'A'), h(5, 'deep'), h(3, 'A1')]))).toEqual([['A', ['deep', 'A1']]]);
  });

  it('keeps headings that come before any shallower heading at the top', () => {
    expect(shape(tocTree([h(4, 'early'), h(2, 'A'), h(3, 'A1')]))).toEqual([
      'early',
      ['A', ['A1']],
    ]);
  });

  it('copies anchors through', () => {
    expect(tocTree([h(3, 'Movies')])).toEqual([{ anchor: 'movies', text: 'Movies', children: [] }]);
  });
});

describe('hasToc', () => {
  it('needs at least three headings', () => {
    expect(hasToc([h(2, 'A'), h(2, 'B')])).toBe(false);
    expect(hasToc([h(2, 'A'), h(2, 'B'), h(3, 'C')])).toBe(true);
  });
});
