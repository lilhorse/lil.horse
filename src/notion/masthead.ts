import type {
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client';
import type { NotionApi } from './api';
import { plainText, readTitle } from './properties';
import type { MastheadEntry } from './types';

function sloganText(block: BlockObjectResponse): RichTextItemResponse[] | null {
  switch (block.type) {
    case 'heading_1':
      return block.heading_1.rich_text;
    case 'heading_2':
      return block.heading_2.rich_text;
    case 'heading_3':
      return block.heading_3.rich_text;
    case 'paragraph':
      return block.paragraph.rich_text;
    case 'quote':
      return block.quote.rich_text;
    case 'callout':
      return block.callout.rich_text;
    default:
      return null;
  }
}

export function mastheadTitle(page: PageObjectResponse): string {
  return readTitle(page.properties);
}

/** The first heading, paragraph, quote or callout with any text, as one line of plain text. */
export function sloganOf(blocks: BlockObjectResponse[]): string | null {
  for (const block of blocks) {
    const richText = sloganText(block);
    const text = richText ? plainText(richText).replace(/\s+/g, ' ').trim() : '';
    if (text) return text;
  }
  return null;
}

export async function readMasthead(api: NotionApi, pageId: string): Promise<MastheadEntry> {
  const page = await api.retrievePage(pageId);
  // Not in parallel: the fixture recorder keeps a page's blocks only once it has recorded the page.
  const blocks = await api.listBlockChildren(pageId);
  return { title: mastheadTitle(page), slogan: sloganOf(blocks) };
}
