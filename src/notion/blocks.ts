import type { BlockObjectResponse } from '@notionhq/client';
import { isNotFoundError, type NotionApi } from './api';

export interface BlockNode {
  block: BlockObjectResponse;
  children: BlockNode[];
}

const LEAF_TYPES = new Set(['child_page', 'child_database']);

async function childrenOf(api: NotionApi, block: BlockObjectResponse): Promise<BlockNode[]> {
  if (block.type === 'synced_block' && block.synced_block.synced_from) {
    const source = block.synced_block.synced_from.block_id;
    try {
      return await fetchBlockTree(api, source);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new Error(
          `Synced block ${block.id} copies ${source}, which is not shared with the integration; share the page that holds the original block`,
          { cause: error },
        );
      }
      throw error;
    }
  }
  if (!block.has_children || LEAF_TYPES.has(block.type)) return [];
  return fetchBlockTree(api, block.id);
}

export async function fetchBlockTree(api: NotionApi, blockId: string): Promise<BlockNode[]> {
  const blocks = await api.listBlockChildren(blockId);
  return Promise.all(
    blocks.map(async (block) => ({ block, children: await childrenOf(api, block) })),
  );
}
