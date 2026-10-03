import type {
  ChildDatabaseBlockObjectResponse,
  CodeBlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
  TableBlockObjectResponse,
} from '@notionhq/client';
import type GithubSlugger from 'github-slugger';
import { slug } from 'github-slugger';
import type { BlockNode } from './blocks';
import type { BookmarkFetcher } from './bookmarks';
import type { MediaStore } from './media';
import {
  audioNode,
  bookmarkNode,
  embedNode,
  fileNode,
  imageNode,
  pageLinkNode,
  videoNode,
} from './media-blocks';
import { isBlank, plain, toRichText } from './rich-text';
import type {
  CodeNode,
  Column,
  DatabaseNode,
  HeadingNode,
  Icon,
  ListNode,
  Node,
  NotionColor,
  TableNode,
} from './types';

export interface AstContext {
  media: MediaStore;
  bookmarks: BookmarkFetcher;
  slugger: GithubSlugger;
  database: (block: ChildDatabaseBlockObjectResponse) => Promise<DatabaseNode | null>;
  warn: (message: string) => void;
}

const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'console', 'powershell', 'shellsession']);
const FILE_NAME = /^[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]+$/;
const LANGUAGE_ALIASES: Record<string, string> = {
  'plain text': 'text',
  'c++': 'cpp',
  'c#': 'csharp',
  'f#': 'fsharp',
  'objective-c': 'objc',
  'visual basic': 'vb',
  'vb.net': 'vb',
  'java/c/c++/c#': 'java',
  docker: 'dockerfile',
  webassembly: 'wasm',
  markup: 'html',
  shell: 'sh',
};

export function mapLanguage(language: string): string {
  const key = language.toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

export function toCodeNode(block: CodeBlockObjectResponse): CodeNode {
  const language = mapLanguage(block.code.language);
  const caption = toRichText(block.code.caption);
  const captionText = plain(caption).trim();
  const isFileName = FILE_NAME.test(captionText);
  return {
    type: 'code',
    id: block.id,
    language,
    code: block.code.rich_text.map((item) => item.plain_text).join(''),
    caption: isFileName ? [] : caption,
    frame: SHELL_LANGUAGES.has(language) ? 'terminal' : isFileName ? 'editor' : 'none',
    title: isFileName ? captionText : null,
  };
}

export async function toIcon(
  icon: PageObjectResponse['icon'],
  media: MediaStore,
): Promise<Icon | null> {
  if (!icon) return null;
  switch (icon.type) {
    case 'emoji':
      return { kind: 'emoji', emoji: icon.emoji };
    case 'external':
      return { kind: 'image', media: await media.ensure(icon.external.url, { kind: 'image' }) };
    case 'file':
      return { kind: 'image', media: await media.ensure(icon.file.url, { kind: 'image' }) };
    case 'custom_emoji':
      return { kind: 'image', media: await media.ensure(icon.custom_emoji.url, { kind: 'image' }) };
    default:
      return null;
  }
}

interface TextContent {
  rich_text: RichTextItemResponse[];
  color: NotionColor;
}

function listNode(
  style: ListNode['style'],
  id: string,
  content: TextContent,
  children: Node[],
  checked: boolean | null,
): ListNode {
  return {
    type: 'list',
    id,
    style,
    items: [
      {
        id,
        text: toRichText(content.rich_text),
        color: content.color,
        checked,
        children,
      },
    ],
  };
}

async function toHeading(
  id: string,
  level: HeadingNode['level'],
  content: TextContent & { is_toggleable: boolean },
  children: BlockNode[],
  ctx: AstContext,
): Promise<HeadingNode | null> {
  const text = toRichText(content.rich_text);
  const title = plain(text).trim();
  // Raw children: converting them first would slug nested headings before this one.
  if (!title && !content.is_toggleable && children.length === 0) return null;
  return {
    type: 'heading',
    id,
    level,
    text,
    anchor: ctx.slugger.slug(slug(title) ? title : 'section'),
    color: content.color,
    toggleable: content.is_toggleable,
    children: await blocksToAst(children, ctx),
  };
}

function toTableNode(block: TableBlockObjectResponse, children: BlockNode[]): TableNode {
  const rows = children.flatMap(({ block: row }) =>
    row.type === 'table_row' ? [row.table_row.cells.map((cell) => toRichText(cell))] : [],
  );
  return {
    type: 'table',
    id: block.id,
    columnHeader: block.table.has_column_header,
    rowHeader: block.table.has_row_header,
    rows,
  };
}

async function convert({ block, children }: BlockNode, ctx: AstContext): Promise<Node | null> {
  const nested = () => blocksToAst(children, ctx);
  // Keep the cases that render children in sync with RENDERS_CHILDREN in src/notion/sanitize.ts.
  switch (block.type) {
    case 'paragraph': {
      const text = toRichText(block.paragraph.rich_text);
      const inner = await nested();
      if (isBlank(text) && inner.length === 0) return null;
      return {
        type: 'paragraph',
        id: block.id,
        text,
        color: block.paragraph.color,
        children: inner,
      };
    }
    case 'heading_1':
      return toHeading(block.id, 2, block.heading_1, children, ctx);
    case 'heading_2':
      return toHeading(block.id, 3, block.heading_2, children, ctx);
    case 'heading_3':
      return toHeading(block.id, 4, block.heading_3, children, ctx);
    case 'heading_4':
      return toHeading(block.id, 5, block.heading_4, children, ctx);
    case 'bulleted_list_item':
      return listNode('bulleted', block.id, block.bulleted_list_item, await nested(), null);
    case 'numbered_list_item':
      return listNode('numbered', block.id, block.numbered_list_item, await nested(), null);
    case 'to_do':
      return listNode('todo', block.id, block.to_do, await nested(), block.to_do.checked);
    case 'toggle':
      return {
        type: 'toggle',
        id: block.id,
        summary: toRichText(block.toggle.rich_text),
        color: block.toggle.color,
        children: await nested(),
      };
    case 'quote':
      return {
        type: 'quote',
        id: block.id,
        text: toRichText(block.quote.rich_text),
        color: block.quote.color,
        children: await nested(),
      };
    case 'callout': {
      if (block.callout.icon?.type === 'icon') {
        ctx.warn(
          `Callout (${block.id}) uses a built-in Notion icon, which can't be shown on the site; use an emoji instead`,
        );
      }
      return {
        type: 'callout',
        id: block.id,
        icon: await toIcon(block.callout.icon, ctx.media),
        text: toRichText(block.callout.rich_text),
        color: block.callout.color,
        children: await nested(),
      };
    }
    case 'divider':
      return { type: 'divider', id: block.id };
    case 'code': {
      const node = toCodeNode(block);
      if (node.code.trim()) return node;
      ctx.warn(`Code block ${block.id} is empty; skipped`);
      return null;
    }
    case 'equation':
      return { type: 'equation', id: block.id, expression: block.equation.expression };
    case 'table':
      return toTableNode(block, children);
    case 'column_list': {
      const columns: Column[] = [];
      // Sequential, so the slugger numbers duplicate headings in document order.
      for (const { block: column, children: columnChildren } of children) {
        if (column.type !== 'column') continue;
        columns.push({
          id: column.id,
          widthRatio: column.column.width_ratio ?? null,
          children: await blocksToAst(columnChildren, ctx),
        });
      }
      return { type: 'columns', id: block.id, columns };
    }
    case 'synced_block':
    case 'tab':
    case 'column': {
      const inner = await nested();
      return inner.length > 0 ? { type: 'container', id: block.id, children: inner } : null;
    }
    case 'image':
      return imageNode(block, ctx);
    case 'video':
      return videoNode(block, ctx);
    case 'audio':
      return audioNode(block, ctx);
    case 'file':
    case 'pdf':
      return fileNode(block, ctx);
    case 'bookmark':
      return bookmarkNode(block, block.bookmark.url, block.bookmark.caption, ctx);
    case 'link_preview':
      return bookmarkNode(block, block.link_preview.url, [], ctx);
    case 'embed':
      return embedNode(block, ctx);
    case 'link_to_page':
    case 'child_page':
      return pageLinkNode(block, ctx);
    case 'child_database':
      return ctx.database(block);
    case 'table_of_contents':
      return { type: 'toc', id: block.id };
    case 'breadcrumb':
    case 'template':
    case 'meeting_notes':
    case 'transcription':
      return null;
    default: {
      const blockType = block.type === 'unsupported' ? block.unsupported.block_type : block.type;
      ctx.warn(`Unsupported Notion block "${blockType}" (${block.id}) skipped`);
      return { type: 'unsupported', id: block.id, blockType };
    }
  }
}

export async function blocksToAst(tree: BlockNode[], ctx: AstContext): Promise<Node[]> {
  const nodes: Node[] = [];
  let separated = false;
  for (const item of tree) {
    const node = await convert(item, ctx);
    if (!node) {
      separated = true;
      continue;
    }
    const previous = nodes.at(-1);
    // A blank line between two lists means two lists in Notion, so numbering restarts.
    if (
      node.type === 'list' &&
      previous?.type === 'list' &&
      previous.style === node.style &&
      !separated
    ) {
      previous.items.push(...node.items);
    } else {
      nodes.push(node);
    }
    separated = false;
  }
  return nodes;
}
