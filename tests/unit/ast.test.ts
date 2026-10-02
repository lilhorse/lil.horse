import type { BlockObjectResponse } from '@notionhq/client';
import GithubSlugger from 'github-slugger';
import { describe, expect, it, vi } from 'vitest';
import { blocksToAst, mapLanguage, type AstContext } from '../../src/notion/ast';
import type { BlockNode } from '../../src/notion/blocks';
import type { BookmarkFetcher } from '../../src/notion/bookmarks';
import type { MediaStore } from '../../src/notion/media';
import type { HeadingNode, ListNode } from '../../src/notion/types';
import { block, rt } from '../helpers/notion-factory';

function context(overrides: Partial<AstContext> = {}) {
  const warnings: string[] = [];
  const ctx: AstContext = {
    media: {} as MediaStore,
    bookmarks: {} as BookmarkFetcher,
    slugger: new GithubSlugger(),
    database: async () => null,
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { ctx, warnings };
}

const leaf = (value: BlockObjectResponse, children: BlockNode[] = []): BlockNode => ({
  block: value,
  children,
});
const paragraph = (text: string) =>
  leaf(block('paragraph', { rich_text: text ? [rt(text)] : [], color: 'default' }));
const bullet = (text: string, children: BlockNode[] = []) =>
  leaf(
    block(
      'bulleted_list_item',
      { rich_text: [rt(text)], color: 'default' },
      { hasChildren: children.length > 0 },
    ),
    children,
  );
const numbered = (text: string) =>
  leaf(block('numbered_list_item', { rich_text: [rt(text)], color: 'default' }));
const heading = (
  level: 1 | 2 | 3 | 4,
  text: string,
  toggleable = false,
  children: BlockNode[] = [],
) =>
  leaf(
    block(
      `heading_${level}`,
      { rich_text: [rt(text)], color: 'default', is_toggleable: toggleable },
      { hasChildren: children.length > 0 },
    ),
    children,
  );

describe('blocksToAst', () => {
  it('drops blank paragraphs and keeps text with colour', async () => {
    const nodes = await blocksToAst([paragraph(''), paragraph('Hello')], context().ctx);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'paragraph', color: 'default' });
  });

  it('shifts heading levels down and builds unique anchors, including Chinese', async () => {
    const nodes = (await blocksToAst(
      [heading(1, 'Movies'), heading(2, '电影 清单'), heading(3, 'Movies'), heading(4, 'Notes')],
      context().ctx,
    )) as HeadingNode[];
    expect(nodes.map((node) => [node.level, node.anchor])).toEqual([
      [2, 'movies'],
      [3, '电影-清单'],
      [4, 'movies-1'],
      [5, 'notes'],
    ]);
  });

  it('keeps the children of a toggleable heading', async () => {
    const [node] = (await blocksToAst(
      [heading(2, 'Spoilers', true, [paragraph('hidden text')])],
      context().ctx,
    )) as HeadingNode[];
    expect(node?.toggleable).toBe(true);
    expect(node?.children).toHaveLength(1);
  });

  it('merges adjacent list items but restarts after a blank line or a different list style', async () => {
    const nodes = (await blocksToAst(
      [
        numbered('one'),
        numbered('two'),
        paragraph(''),
        numbered('again'),
        bullet('a'),
        bullet('b', [bullet('nested')]),
      ],
      context().ctx,
    )) as ListNode[];
    expect(nodes.map((node) => [node.style, node.items.length])).toEqual([
      ['numbered', 2],
      ['numbered', 1],
      ['bulleted', 2],
    ]);
    expect(nodes[2]?.items[1]?.children[0]).toMatchObject({ type: 'list', style: 'bulleted' });
  });

  it('marks to-dos as checked or not', async () => {
    const [node] = (await blocksToAst(
      [leaf(block('to_do', { rich_text: [rt('ship')], color: 'default', checked: true }))],
      context().ctx,
    )) as ListNode[];
    expect(node).toMatchObject({ style: 'todo', items: [{ checked: true }] });
  });

  it('maps code languages and picks a frame', async () => {
    const code = (language: string, caption: string) =>
      leaf(
        block('code', {
          rich_text: [rt('echo hi')],
          caption: caption ? [rt(caption)] : [],
          language,
        }),
      );
    const nodes = await blocksToAst(
      [code('shell', ''), code('typescript', 'src/app.ts'), code('plain text', 'Output')],
      context().ctx,
    );
    expect(nodes).toMatchObject([
      { type: 'code', language: 'sh', frame: 'terminal', title: null },
      { type: 'code', language: 'typescript', frame: 'editor', title: 'src/app.ts', caption: [] },
      { type: 'code', language: 'text', frame: 'none', title: null },
    ]);
    expect(mapLanguage('C++')).toBe('cpp');
  });

  it('builds tables, columns, callouts and containers', async () => {
    const table = leaf(
      block(
        'table',
        { table_width: 2, has_column_header: true, has_row_header: false },
        { hasChildren: true },
      ),
      [
        leaf(block('table_row', { cells: [[rt('Title')], [rt('Rating')]] })),
        leaf(block('table_row', { cells: [[rt('Strays')], [rt('5')]] })),
      ],
    );
    const columns = leaf(block('column_list', {}, { hasChildren: true }), [
      leaf(block('column', { width_ratio: 0.6 }, { hasChildren: true }), [paragraph('left')]),
      leaf(block('column', {}, { hasChildren: true }), [paragraph('right')]),
    ]);
    const callout = leaf(
      block('callout', {
        rich_text: [rt('Note')],
        color: 'gray_background',
        icon: { type: 'emoji', emoji: '💡' },
      }),
    );
    const tab = leaf(block('tab', {}, { hasChildren: true }), [paragraph('inside tab')]);
    const emptySynced = leaf(block('synced_block', { synced_from: null }));

    const nodes = await blocksToAst([table, columns, callout, tab, emptySynced], context().ctx);
    expect(nodes).toMatchObject([
      {
        type: 'table',
        columnHeader: true,
        rowHeader: false,
        rows: [
          [[{ text: 'Title' }], [{ text: 'Rating' }]],
          [[{ text: 'Strays' }], [{ text: '5' }]],
        ],
      },
      { type: 'columns', columns: [{ widthRatio: 0.6 }, { widthRatio: null }] },
      { type: 'callout', icon: { kind: 'emoji', emoji: '💡' }, color: 'gray_background' },
      { type: 'container', children: [{ type: 'paragraph' }] },
    ]);
  });

  it('delegates inline databases and warns about unsupported blocks', async () => {
    const database = vi.fn(async () => null);
    const { ctx, warnings } = context({ database });
    const nodes = await blocksToAst(
      [
        leaf(block('child_database', { title: 'Movies' })),
        leaf(block('ai_block', {})),
        leaf(block('breadcrumb', {})),
      ],
      ctx,
    );
    expect(database).toHaveBeenCalledOnce();
    expect(nodes).toMatchObject([{ type: 'unsupported', blockType: 'ai_block' }]);
    expect(warnings[0]).toContain('ai_block');
  });
});
