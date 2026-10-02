import { plain } from './rich-text';
import type { HeadingRef, Node, RichText } from './types';

const CJK = /[\u{3400}-\u{9FFF}\u{F900}-\u{FAFF}]/gu;

function unreachable(node: never): never {
  throw new Error(`Unexpected AST node type "${(node as Node).type}"`);
}

export function walk(
  nodes: Node[],
  visit: (node: Node) => void,
  descend: (node: Node) => boolean = () => true,
): void {
  for (const node of nodes) {
    visit(node);
    if (!descend(node)) continue;
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'quote':
      case 'callout':
      case 'toggle':
      case 'container':
        walk(node.children, visit, descend);
        break;
      case 'list':
        for (const item of node.items) walk(item.children, visit, descend);
        break;
      case 'columns':
        for (const column of node.columns) walk(column.children, visit, descend);
        break;
      case 'divider':
      case 'code':
      case 'equation':
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'bookmark':
      case 'table':
      case 'database':
      case 'toc':
      case 'page_link':
      case 'unsupported':
        break;
      default:
        unreachable(node);
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
    case 'divider':
    case 'equation':
    case 'columns':
    case 'toc':
    case 'page_link':
    case 'container':
    case 'unsupported':
      return [];
    default:
      return unreachable(node);
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

const showsChildren = (node: Node): boolean =>
  node.type !== 'toggle' && !(node.type === 'heading' && node.toggleable);

export function firstParagraph(nodes: Node[]): string | null {
  let found: string | null = null;
  walk(
    nodes,
    (node) => {
      if (found === null && node.type === 'paragraph' && plain(node.text).trim())
        found = plain(node.text).trim();
    },
    showsChildren,
  );
  return found;
}

export function collectHeadings(nodes: Node[]): HeadingRef[] {
  const headings: HeadingRef[] = [];
  walk(nodes, (node) => {
    if (node.type !== 'heading') return;
    const text = plain(node.text).trim();
    // Blank headings still render, but would be nameless table-of-contents links.
    if (text) headings.push({ anchor: node.anchor, text, level: node.level });
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
      case 'paragraph':
      case 'heading':
      case 'list':
      case 'quote':
      case 'toggle':
      case 'divider':
      case 'code':
      case 'equation':
      case 'table':
      case 'columns':
      case 'toc':
      case 'page_link':
      case 'container':
      case 'unsupported':
        break;
      default:
        unreachable(node);
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
  walk(
    nodes,
    (node) => {
      if (found === null && node.type === 'image') found = node.id;
    },
    showsChildren,
  );
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
  const chars = Array.from(
    new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(clean),
    (s) => s.segment,
  );
  if (chars.length <= max) return clean;
  const splitsWord = [chars[max - 2], chars[max - 1]].every((char) => /[A-Za-z0-9]/.test(char));
  const space = chars.lastIndexOf(' ', max - 1);
  const cut = chars
    .slice(0, splitsWord && space > Math.max(0, max - 30) ? space : max - 1)
    .join('');
  return `${cut.replace(/[\s,.;:!?，。；：！？、]+$/, '')}…`;
}
