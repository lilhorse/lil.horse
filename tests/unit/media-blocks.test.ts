import type { BlockObjectResponse } from '@notionhq/client';
import GithubSlugger from 'github-slugger';
import { describe, expect, it } from 'vitest';
import { blocksToAst, type AstContext } from '../../src/notion/ast';
import type { BookmarkFetcher } from '../../src/notion/bookmarks';
import { vimeoId, youtubeId } from '../../src/notion/media-blocks';
import type { MediaStore } from '../../src/notion/media';
import type { MediaRef } from '../../src/notion/types';
import { block, rt } from '../helpers/notion-factory';

const PAGE = '71d7802a0abf4857a535dfd861d8491e';

function harness() {
  const ensured: { url: string; kind: string; hint?: string }[] = [];
  const warnings: string[] = [];
  const media = {
    ensure: async (
      url: string,
      options: { kind: 'image' | 'file'; fileNameHint?: string },
    ): Promise<MediaRef> => {
      ensured.push({
        url,
        kind: options.kind,
        ...(options.fileNameHint ? { hint: options.fileNameHint } : {}),
      });
      return {
        key: 'k'.repeat(16),
        kind: options.kind,
        mime: 'image/png',
        bytes: 1,
        fileName: options.fileNameHint ?? 'f',
        src: '/_media/k/f',
        width: 10,
        height: 10,
        variants: [],
        dominant: null,
      };
    },
  } as unknown as MediaStore;
  const bookmarks = {
    get: async (url: string) => ({
      title: `Title of ${url}`,
      description: null,
      siteName: null,
      image: null,
      icon: null,
    }),
  } as unknown as BookmarkFetcher;
  const ctx: AstContext = {
    media,
    bookmarks,
    slugger: new GithubSlugger(),
    database: async () => null,
    warn: (message) => warnings.push(message),
  };
  const run = (blocks: BlockObjectResponse[]) =>
    blocksToAst(
      blocks.map((value) => ({ block: value, children: [] })),
      ctx,
    );
  return { ensured, warnings, run };
}

describe('video ids', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=3', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://example.com/watch?v=x', null],
  ])('youtubeId(%s)', (url, expected) => {
    expect(youtubeId(url)).toBe(expected);
  });

  it('parses Vimeo ids', () => {
    expect(vimeoId('https://vimeo.com/123456')).toBe('123456');
    expect(vimeoId('https://player.vimeo.com/video/123456')).toBe('123456');
    expect(vimeoId('https://example.com/123456')).toBeNull();
  });
});

describe('media blocks', () => {
  it('turns images into media with alt text from the caption', async () => {
    const { run, warnings, ensured } = harness();
    const nodes = await run([
      block('image', {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?sig=1',
          expiry_time: 'x',
        },
        caption: [rt('A horse')],
      }),
      block('image', {
        type: 'external',
        external: { url: 'https://example.com/b.png' },
        caption: [],
      }),
    ]);
    expect(nodes).toMatchObject([
      { type: 'image', alt: 'A horse' },
      { type: 'image', alt: '' },
    ]);
    expect(ensured.map((entry) => entry.kind)).toEqual(['image', 'image']);
    expect(warnings).toHaveLength(1);
  });

  it('recognises YouTube, Vimeo, uploaded and other videos', async () => {
    const { run, ensured } = harness();
    const nodes = await run([
      block('video', {
        type: 'external',
        external: { url: 'https://youtu.be/dQw4w9WgXcQ' },
        caption: [],
      }),
      block('video', {
        type: 'external',
        external: { url: 'https://vimeo.com/123456' },
        caption: [],
      }),
      block('video', {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/v.mp4',
          expiry_time: 'x',
        },
        caption: [],
      }),
      block('video', {
        type: 'external',
        external: { url: 'https://example.com/clip' },
        caption: [],
      }),
    ]);
    expect(nodes.map((node) => (node.type === 'video' ? node.source.kind : node.type))).toEqual([
      'youtube',
      'vimeo',
      'file',
      'link',
    ]);
    expect(ensured[0]?.url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('keeps file names, embeds and bookmarks', async () => {
    const { run, ensured } = harness();
    const nodes = await run([
      block('file', {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/x/cv.pdf',
          expiry_time: 'x',
        },
        caption: [],
        name: 'CV 2026.pdf',
      }),
      block('pdf', {
        type: 'external',
        external: { url: 'https://example.com/docs/paper.pdf' },
        caption: [],
      }),
      block('audio', {
        type: 'external',
        external: { url: 'https://example.com/a.mp3' },
        caption: [],
      }),
      block('embed', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: [] }),
      block('embed', { url: 'https://codepen.io/pen/1', caption: [] }),
      block('bookmark', { url: 'https://example.com/post', caption: [rt('Worth reading')] }),
      block('link_preview', { url: 'https://github.com/lilhorse' }),
    ]);
    expect(nodes.map((node) => node.type)).toEqual([
      'file',
      'file',
      'audio',
      'video',
      'bookmark',
      'bookmark',
      'bookmark',
    ]);
    expect(nodes[0]).toMatchObject({ name: 'CV 2026.pdf' });
    expect(nodes[1]).toMatchObject({ name: 'paper.pdf' });
    expect(nodes[5]).toMatchObject({ meta: { title: 'Title of https://example.com/post' } });
    expect(ensured.find((entry) => entry.hint === 'CV 2026.pdf')?.kind).toBe('file');
  });

  it('links to pages and skips other link targets', async () => {
    const { run, warnings } = harness();
    const nodes = await run([
      block('link_to_page', { type: 'page_id', page_id: '71d7802a-0abf-4857-a535-dfd861d8491e' }),
      block('child_page', { title: 'Sub page' }, { id: PAGE }),
      block('link_to_page', { type: 'database_id', database_id: PAGE }),
    ]);
    expect(nodes).toMatchObject([
      { type: 'page_link', pageId: PAGE, title: '' },
      { type: 'page_link', pageId: PAGE, title: 'Sub page' },
    ]);
    expect(warnings[0]).toContain('database_id');
  });
});
