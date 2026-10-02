import { describe, expect, it } from 'vitest';
import { fetchBlockTree } from '../../src/notion/blocks';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, nextId } from '../helpers/notion-factory';

describe('fetchBlockTree', () => {
  it('descends into children, resolves synced references and stops at child pages and databases', async () => {
    const api = new FakeNotionApi();
    const root = nextId();
    const toggle = block('toggle', { rich_text: [], color: 'default' }, { hasChildren: true });
    const original = nextId();
    const synced = block(
      'synced_block',
      { synced_from: { type: 'block_id', block_id: original } },
      { hasChildren: true },
    );
    const childPage = block('child_page', { title: 'Sub page' }, { hasChildren: true });
    const childDatabase = block('child_database', { title: 'Movies' }, { hasChildren: true });
    const inner = block('paragraph', { rich_text: [], color: 'default' });
    const fromOriginal = block('paragraph', { rich_text: [], color: 'default' });
    api.setChildren(root, [toggle, synced, childPage, childDatabase]);
    api.setChildren(toggle.id, [inner]);
    api.setChildren(original, [fromOriginal]);

    const tree = await fetchBlockTree(api, root);

    expect(tree.map((node) => node.block.type)).toEqual([
      'toggle',
      'synced_block',
      'child_page',
      'child_database',
    ]);
    expect(tree[0]?.children.map((node) => node.block.id)).toEqual([inner.id]);
    expect(tree[1]?.children.map((node) => node.block.id)).toEqual([fromOriginal.id]);
    expect(tree[2]?.children).toEqual([]);
    expect(tree[3]?.children).toEqual([]);
    expect(api.calls).not.toContain(`listBlockChildren:${childPage.id}`);
    expect(api.calls).not.toContain(`listBlockChildren:${synced.id}`);
  });
});
