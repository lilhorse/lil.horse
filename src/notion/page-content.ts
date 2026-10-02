import GithubSlugger from 'github-slugger';
import type { NotionApi } from './api';
import { blocksToAst } from './ast';
import { fetchBlockTree } from './blocks';
import type { BookmarkFetcher } from './bookmarks';
import { buildDatabaseNode } from './database';
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

// Ids the page layout already uses (Base.astro's <main id="main">) must never become heading anchors.
const LAYOUT_IDS = ['main'];

export async function buildPageContent(
  pageId: string,
  deps: PageContentDeps,
): Promise<PageContent> {
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
