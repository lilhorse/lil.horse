import { describe, expect, it, vi } from 'vitest';
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
    expect([...api.calls].sort()).toEqual(
      [root, toggle.id, original].map((id) => `listBlockChildren:${id}`).sort(),
    );
  });

  it('names the synced block when its original is not shared and rethrows other errors unchanged', async () => {
    const api = new FakeNotionApi();
    const root = nextId();
    const original = nextId();
    const synced = block(
      'synced_block',
      { synced_from: { type: 'block_id', block_id: original } },
      { hasChildren: true },
    );
    api.setChildren(root, [synced]);
    const list = api.listBlockChildren.bind(api);
    let failure = Object.assign(new Error('not shared'), { code: 'object_not_found' });
    vi.spyOn(api, 'listBlockChildren').mockImplementation(async (id) => {
      if (id === original) throw failure;
      return list(id);
    });

    const rejection = fetchBlockTree(api, root);
    await expect(rejection).rejects.toThrow(`Synced block ${synced.id} copies ${original}`);
    await expect(rejection).rejects.toHaveProperty('cause.code', 'object_not_found');

    failure = Object.assign(new Error('Service unavailable'), { code: 'service_unavailable' });
    await expect(fetchBlockTree(api, root)).rejects.toBe(failure);
  });
});
