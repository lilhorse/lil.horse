import { plain } from './rich-text';
import type { HeadingRef, Node, RichText } from './types';

const CJK = /[㐀-鿿豈-﫿]/g;

export function walk(nodes: Node[], visit: (node: Node) => void): void {
  for (const node of nodes) {
    visit(node);
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'quote':
      case 'callout':
      case 'toggle':
      case 'container':
        walk(node.children, visit);
        break;
      case 'list':
        for (const item of node.items) walk(item.children, visit);
        break;
      case 'columns':
        for (const column of node.columns) walk(column.children, visit);
        break;
      default:
        break;
    }
  }
}

export function richTextsOf(node: Node): RichText[] {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'callout':
      return [node.text];
    case 'toggle':
      return [node.summary];
    case 'list':
      return node.items.map((item) => item.text);
    case 'code':
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'bookmark':
      return [node.caption];
    case 'table':
      return node.rows.flat();
    case 'database':
      return node.rows.flatMap((row) =>
        Object.values(row.cells).flatMap((cell) => (cell.kind === 'text' ? [cell.text] : [])),
      );
    default:
      return [];
  }
}

export function collectPlainText(nodes: Node[]): string {
  const parts: string[] = [];
  walk(nodes, (node) => {
    if (node.type === 'code' || node.type === 'database') return;
    if (['image', 'video', 'audio', 'file', 'bookmark'].includes(node.type)) return;
    for (const text of richTextsOf(node)) parts.push(plain(text));
  });
  return parts.filter((part) => part.trim() !== '').join('\n');
}

export function firstParagraph(nodes: Node[]): string | null {
  let found: string | null = null;
  walk(nodes, (node) => {
    if (found === null && node.type === 'paragraph' && plain(node.text).trim())
      found = plain(node.text).trim();
  });
  return found;
}

export function collectHeadings(nodes: Node[]): HeadingRef[] {
  const headings: HeadingRef[] = [];
  walk(nodes, (node) => {
    if (node.type === 'heading')
      headings.push({ anchor: node.anchor, text: plain(node.text).trim(), level: node.level });
  });
  return headings;
}

export function collectMediaKeys(nodes: Node[]): string[] {
  const keys = new Set<string>();
  walk(nodes, (node) => {
    switch (node.type) {
      case 'image':
      case 'audio':
      case 'file':
        keys.add(node.media.key);
        break;
      case 'video':
        if (node.source.kind === 'file') keys.add(node.source.media.key);
        if (node.source.kind === 'youtube' && node.source.poster) keys.add(node.source.poster.key);
        break;
      case 'bookmark':
        if (node.meta?.image) keys.add(node.meta.image.key);
        if (node.meta?.icon) keys.add(node.meta.icon.key);
        break;
      case 'callout':
        if (node.icon?.kind === 'image') keys.add(node.icon.media.key);
        break;
      case 'database':
        for (const row of node.rows) {
          for (const cell of Object.values(row.cells))
            if (cell.kind === 'media') for (const item of cell.items) keys.add(item.key);
        }
        break;
      default:
        break;
    }
  });
  return [...keys];
}

export function collectLinkedPageIds(nodes: Node[]): string[] {
  const ids = new Set<string>();
  walk(nodes, (node) => {
    if (node.type === 'page_link') ids.add(node.pageId);
    for (const text of richTextsOf(node))
      for (const span of text) if (span.kind === 'text' && span.pageId) ids.add(span.pageId);
  });
  return [...ids];
}

export function hasMath(nodes: Node[]): boolean {
  let found = false;
  walk(nodes, (node) => {
    if (
      node.type === 'equation' ||
      richTextsOf(node).some((text) => text.some((span) => span.kind === 'equation'))
    )
      found = true;
  });
  return found;
}

export function firstImageId(nodes: Node[]): string | null {
  let found: string | null = null;
  walk(nodes, (node) => {
    if (found === null && node.type === 'image') found = node.id;
  });
  return found;
}

export function readingMinutes(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text
    .replace(CJK, ' ')
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
  return Math.max(1, Math.ceil(words / 230 + cjk / 400));
}

export function excerpt(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max - 30) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,.;:!?，。；：！？、]+$/, '')}…`;
}
