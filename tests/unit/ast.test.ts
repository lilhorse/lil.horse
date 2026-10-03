import type { BlockObjectResponse } from '@notionhq/client';
import GithubSlugger from 'github-slugger';
import { describe, expect, it, vi } from 'vitest';
import { blocksToAst, mapLanguage, toIcon, type AstContext } from '../../src/notion/ast';
import type { BlockNode } from '../../src/notion/blocks';
import type { BookmarkFetcher } from '../../src/notion/bookmarks';
import type { MediaStore } from '../../src/notion/media';
import type { HeadingNode, ListNode, MediaRef } from '../../src/notion/types';
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
    const nodes = (await blocksToAst(
      [heading(2, 'Spoilers', true, [paragraph('hidden text')])],
      context().ctx,
    )) as HeadingNode[];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.toggleable).toBe(true);
    expect(nodes[0]?.children).toMatchObject([{ type: 'paragraph' }]);
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
    const todo = (text: string, checked: boolean) =>
      leaf(block('to_do', { rich_text: [rt(text)], color: 'default', checked }));
    const nodes = await blocksToAst([todo('ship', true), todo('test', false)], context().ctx);
    expect(nodes).toMatchObject([
      { type: 'list', style: 'todo', items: [{ checked: true }, { checked: false }] },
    ]);
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

  it.each([
    ['an empty', []],
    ['a whitespace-only', [rt(' \n\t')]],
  ])('skips %s code block with a warning', async (_, richText) => {
    const empty = leaf(block('code', { rich_text: richText, caption: [], language: 'python' }));
    const { ctx, warnings } = context();
    expect(await blocksToAst([paragraph('before'), empty, paragraph('after')], ctx)).toMatchObject([
      { type: 'paragraph' },
      { type: 'paragraph' },
    ]);
    expect(warnings).toEqual([`Code block ${empty.block.id} is empty; skipped`]);
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

  it('maps toggles, quotes, dividers, equations and tables of contents with their colours', async () => {
    const nodes = await blocksToAst(
      [
        leaf(
          block(
            'toggle',
            { rich_text: [rt('More')], color: 'blue_background' },
            { hasChildren: true },
          ),
          [paragraph('inside toggle')],
        ),
        leaf(block('quote', { rich_text: [rt('Said')], color: 'red' }, { hasChildren: true }), [
          paragraph('inside quote'),
        ]),
        leaf(block('divider', {})),
        leaf(block('equation', { expression: 'e^{i\\pi} + 1 = 0' })),
        leaf(block('table_of_contents', { color: 'default' })),
      ],
      context().ctx,
    );
    expect(nodes).toMatchObject([
      {
        type: 'toggle',
        summary: [{ text: 'More' }],
        color: 'blue_background',
        children: [{ type: 'paragraph' }],
      },
      { type: 'quote', text: [{ text: 'Said' }], color: 'red', children: [{ type: 'paragraph' }] },
      { type: 'divider' },
      { type: 'equation', expression: 'e^{i\\pi} + 1 = 0' },
      { type: 'toc' },
    ]);
  });

  it('marks a table with a row header', async () => {
    const table = leaf(
      block(
        'table',
        { table_width: 2, has_column_header: false, has_row_header: true },
        { hasChildren: true },
      ),
      [leaf(block('table_row', { cells: [[rt('Year')], [rt('2024')]] }))],
    );
    const nodes = await blocksToAst([table], context().ctx);
    expect(nodes).toMatchObject([
      {
        type: 'table',
        columnHeader: false,
        rowHeader: true,
        rows: [[[{ text: 'Year' }], [{ text: '2024' }]]],
      },
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
    expect(warnings).toEqual([expect.stringContaining('ai_block')]);
  });

  it('names the real type of a block the API reports as unsupported', async () => {
    const { ctx, warnings } = context();
    const nodes = await blocksToAst([leaf(block('unsupported', { block_type: 'ai_block' }))], ctx);
    expect(nodes).toMatchObject([{ type: 'unsupported', blockType: 'ai_block' }]);
    expect(warnings[0]).toContain('"ai_block"');
  });

  it('gives headings without letters or digits a non-empty anchor', async () => {
    const nodes = (await blocksToAst(
      [heading(2, '🎬'), heading(2, '!!!')],
      context().ctx,
    )) as HeadingNode[];
    expect(nodes.map((node) => node.anchor)).toEqual(['section', 'section-1']);
  });

  it('drops blank headings unless they are toggleable or have children', async () => {
    const nodes = await blocksToAst(
      [
        heading(1, ''),
        heading(2, '  '),
        heading(2, '', true),
        heading(3, '', false, [paragraph('under a blank heading')]),
      ],
      context().ctx,
    );
    expect(nodes).toMatchObject([
      { type: 'heading', toggleable: true, anchor: 'section', children: [] },
      {
        type: 'heading',
        toggleable: false,
        anchor: 'section-1',
        children: [{ type: 'paragraph' }],
      },
    ]);
  });

  it('splits a list at a dropped blank heading', async () => {
    const nodes = await blocksToAst(
      [numbered('one'), heading(2, ''), numbered('two')],
      context().ctx,
    );
    expect(nodes).toMatchObject([
      { type: 'list', style: 'numbered', items: [{ text: [{ text: 'one' }] }] },
      { type: 'list', style: 'numbered', items: [{ text: [{ text: 'two' }] }] },
    ]);
  });

  it('numbers duplicate headings in columns in document order', async () => {
    const database = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), 10));
    const columns = leaf(block('column_list', {}, { hasChildren: true }), [
      leaf(block('column', {}, { hasChildren: true }), [
        leaf(block('child_database', { title: 'Slow' })),
        heading(2, 'Notes'),
      ]),
      leaf(block('column', {}, { hasChildren: true }), [heading(2, 'Notes')]),
    ]);
    const nodes = await blocksToAst([columns], context({ database }).ctx);
    expect(nodes).toMatchObject([
      {
        type: 'columns',
        columns: [{ children: [{ anchor: 'notes' }] }, { children: [{ anchor: 'notes-1' }] }],
      },
    ]);
  });

  it('warns that a callout cannot show a built-in Notion icon', async () => {
    const { ctx, warnings } = context();
    const callout = block('callout', {
      rich_text: [rt('Heads up')],
      color: 'default',
      icon: { type: 'icon', icon: { name: 'star', color: 'gray' } },
    });
    const nodes = await blocksToAst([leaf(callout)], ctx);
    expect(nodes).toMatchObject([{ type: 'callout', icon: null }]);
    expect(warnings).toEqual([expect.stringContaining(`Callout (${callout.id})`)]);
    expect(warnings[0]).toMatch(/built-in Notion icon.+can't be shown on the site.+use an emoji/);
  });
});

describe('toIcon', () => {
  it('downloads an external icon through the media store', async () => {
    const ref = { key: 'icon', src: '/_media/icon/icon.png' } as MediaRef;
    const ensure = vi.fn<MediaStore['ensure']>(async () => ref);
    const icon = await toIcon(
      { type: 'external', external: { url: 'https://example.com/icon.png' } },
      { ensure } as unknown as MediaStore,
    );
    expect(icon).toEqual({ kind: 'image', media: ref });
    expect(ensure).toHaveBeenCalledExactlyOnceWith('https://example.com/icon.png', {
      kind: 'image',
    });
  });

  it('returns null for a built-in Notion icon, which has no URL', async () => {
    const icon = await toIcon(
      { type: 'icon', icon: { name: 'star', color: 'gray' } },
      {} as MediaStore,
    );
    expect(icon).toBeNull();
  });
});
