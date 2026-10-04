import GithubSlugger from 'github-slugger';
import type { NotionApi } from './api';
import { blocksToAst } from './ast';
import { fetchBlockTree } from './blocks';
import type { BookmarkFetcher } from './bookmarks';
import { buildDatabaseNode } from './database';
import { notionUrl } from './ids';
import type { MediaStore } from './media';
import {
  collectHeadings,
  collectLinkedPageIds,
  collectMediaKeys,
  collectPlainText,
  firstImageId,
  firstParagraph,
  hasMath,
} from './text';
import type { DatabaseDisplay, PageContent } from './types';

export interface PageContentDeps {
  api: NotionApi;
  media: MediaStore;
  bookmarks: BookmarkFetcher;
  databaseDisplay: Record<string, DatabaseDisplay>;
  warn: (message: string) => void;
}

// Ids the page layout already uses (<main>, the dialogs, the comments section) must never become heading anchors.
const LAYOUT_IDS = [
  'main',
  'palette-query',
  'palette-options',
  'palette-nav-home',
  'palette-nav-blog',
  'palette-nav-projects',
  'palette-nav-about',
  'palette-nav-contact',
  'palette-theme',
  'palette-copy-email',
  'palette-email',
  'palette-rss',
  'palette-help',
  'help-title',
  'comments-title',
];

export async function buildPageContent(
  pageId: string,
  deps: PageContentDeps,
): Promise<PageContent> {
  const url = notionUrl(pageId);
  try {
    return await assemble(pageId, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build Notion page ${url}: ${message}`, { cause: error });
  }
}

async function assemble(pageId: string, deps: PageContentDeps): Promise<PageContent> {
  const tree = await fetchBlockTree(deps.api, pageId);
  const childDataSourceIds = new Set<string>();
  const slugger = new GithubSlugger();
  for (const id of LAYOUT_IDS) slugger.slug(id);
  const blocks = await blocksToAst(tree, {
    media: deps.media,
    bookmarks: deps.bookmarks,
    slugger,
    warn: deps.warn,
    database: (block) =>
      buildDatabaseNode(block, {
        api: deps.api,
        media: deps.media,
        display: deps.databaseDisplay,
        warn: deps.warn,
        onDataSource: (id) => childDataSourceIds.add(id),
      }),
  });
  return {
    blocks,
    headings: collectHeadings(blocks),
    plainText: collectPlainText(blocks),
    firstParagraph: firstParagraph(blocks),
    hasMath: hasMath(blocks),
    priorityImageId: firstImageId(blocks),
    childDataSourceIds: [...childDataSourceIds].sort(),
    mediaKeys: collectMediaKeys(blocks),
    linkedPageIds: collectLinkedPageIds(blocks),
  };
}
