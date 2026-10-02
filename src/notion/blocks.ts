import type { BlockObjectResponse } from '@notionhq/client';
import type { NotionApi } from './api';

export interface BlockNode {
  block: BlockObjectResponse;
  children: BlockNode[];
}

const LEAF_TYPES = new Set(['child_page', 'child_database']);

async function childrenOf(api: NotionApi, block: BlockObjectResponse): Promise<BlockNode[]> {
  if (block.type === 'synced_block' && block.synced_block.synced_from) {
    return fetchBlockTree(api, block.synced_block.synced_from.block_id);
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
