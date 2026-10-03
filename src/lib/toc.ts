import type { HeadingRef } from '../notion/types';

export interface TocItem {
  anchor: string;
  text: string;
  children: TocItem[];
}

export const TOC_MIN_HEADINGS = 3;

export function hasToc(headings: HeadingRef[]): boolean {
  return headings.length >= TOC_MIN_HEADINGS;
}

/** Nests each heading under the closest earlier heading of a higher level, so skipped levels nest one step. */
export function tocTree(headings: HeadingRef[]): TocItem[] {
  const root: TocItem[] = [];
  const stack: { level: number; item: TocItem }[] = [];
  for (const heading of headings) {
    const item: TocItem = { anchor: heading.anchor, text: heading.text, children: [] };
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    (stack.at(-1)?.item.children ?? root).push(item);
    stack.push({ level: heading.level, item });
  }
  return root;
}
