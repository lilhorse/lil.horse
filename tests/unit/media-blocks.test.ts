import type { BlockObjectResponse } from '@notionhq/client';
import GithubSlugger from 'github-slugger';
import { describe, expect, it } from 'vitest';
import { blocksToAst, type AstContext } from '../../src/notion/ast';
import type { BookmarkFetcher } from '../../src/notion/bookmarks';
import { vimeoVideo, youtubeId } from '../../src/notion/media-blocks';
import { MediaDownloadError, type MediaStore } from '../../src/notion/media';
import type { MediaRef } from '../../src/notion/types';
import { block, rt } from '../helpers/notion-factory';

const PAGE = '71d7802a0abf4857a535dfd861d8491e';

function harness(failure?: Error) {
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
      if (failure) throw failure;
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
    ['https://www.youtube.com/watch?v=', null],
    ['https://www.youtube.com/watch?v=a/b?c', null],
  ])('youtubeId(%s)', (url, expected) => {
    expect(youtubeId(url)).toBe(expected);
  });

  it.each([
    ['https://vimeo.com/123456', { videoId: '123456', hash: null }],
    ['https://vimeo.com/123456/0d8c6fc8a5', { videoId: '123456', hash: '0d8c6fc8a5' }],
    ['https://www.vimeo.com/123456/0D8C6FC8A5/', { videoId: '123456', hash: '0D8C6FC8A5' }],
    ['https://vimeo.com/channels/staffpicks/123456', { videoId: '123456', hash: null }],
    ['https://player.vimeo.com/video/123456', { videoId: '123456', hash: null }],
    [
      'https://player.vimeo.com/video/123456?h=0d8c6fc8a5&badge=0',
      { videoId: '123456', hash: '0d8c6fc8a5' },
    ],
    ['https://vimeo.com/showcase/7891011', null],
    ['https://vimeo.com/album/123/video/456', null],
    ['https://vimeo.com/123456/not-a-hash', null],
    ['https://vimeo.com/channels/staffpicks/123456/0d8c6fc8a5', null],
    ['https://player.vimeo.com/video/123456?h=not-a-hash', null],
    ['https://vimeo.com/user123456', null],
    ['https://example.com/123456', null],
  ])('vimeoVideo(%s)', (url, expected) => {
    expect(vimeoVideo(url)).toEqual(expected);
  });
});

describe('media blocks', () => {
  it('turns images into media with alt text from the caption', async () => {
    const { run, warnings, ensured } = harness();
    const uncaptioned = block('image', {
      type: 'external',
      external: { url: 'https://example.com/b.png' },
      caption: [],
    });
    const nodes = await run([
      block('image', {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?sig=1',
          expiry_time: 'x',
        },
        caption: [rt('A horse')],
      }),
      uncaptioned,
    ]);
    expect(nodes).toMatchObject([
      { type: 'image', alt: 'A horse' },
      { type: 'image', alt: '' },
    ]);
    expect(ensured.map((entry) => entry.kind)).toEqual(['image', 'image']);
    expect(warnings).toEqual([
      `Image ${uncaptioned.id} has no caption; its alt text will be empty`,
    ]);
  });

  it('fails when an image cannot be downloaded', async () => {
    const failure = new MediaDownloadError(
      'Failed to download https://example.com/b.png: HTTP 404',
      { status: 404 },
    );
    const { run } = harness(failure);
    const image = block('image', {
      type: 'external',
      external: { url: 'https://example.com/b.png' },
      caption: [rt('B')],
    });
    await expect(run([image])).rejects.toBe(failure);
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
    expect(nodes.map((node) => (node.type === 'video' ? node.source : node.type))).toMatchObject([
      { kind: 'youtube', videoId: 'dQw4w9WgXcQ' },
      { kind: 'vimeo', videoId: '123456', hash: null },
      { kind: 'file' },
      { kind: 'link', url: 'https://example.com/clip' },
    ]);
    expect(ensured).toEqual([
      { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', kind: 'image' },
      { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/v.mp4', kind: 'file' },
    ]);
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

  it('keeps a file name that is not valid percent-encoding', async () => {
    const { run } = harness();
    const nodes = await run(
      ['50%off.pdf', 'caf%E9.pdf'].map((name) =>
        block('pdf', {
          type: 'external',
          external: { url: `https://example.com/${name}` },
          caption: [],
        }),
      ),
    );
    expect(nodes).toMatchObject([
      { type: 'file', name: '50%off.pdf' },
      { type: 'file', name: 'caf%E9.pdf' },
    ]);
  });

  it('keeps YouTube playlist and live-stream embeds as bookmarks', async () => {
    const { run, ensured } = harness();
    const urls = [
      'https://www.youtube.com/embed/videoseries?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs',
      'https://www.youtube.com/embed/live_stream?channel=UC4R8DWoMoI7CAwX8_LjQHig',
    ];
    const nodes = await run(urls.map((url) => block('embed', { url, caption: [] })));
    expect(nodes).toMatchObject(urls.map((url) => ({ type: 'bookmark', url })));
    expect(ensured).toEqual([]);
  });

  it('turns Vimeo videos and embeds into videos that keep the unlisted hash', async () => {
    const { run } = harness();
    const nodes = await run([
      block('video', {
        type: 'external',
        external: { url: 'https://vimeo.com/123456/0d8c6fc8a5' },
        caption: [],
      }),
      block('embed', { url: 'https://player.vimeo.com/video/123456?h=0d8c6fc8a5', caption: [] }),
      block('embed', { url: 'https://vimeo.com/123456', caption: [] }),
    ]);
    expect(nodes).toMatchObject([
      { type: 'video', source: { kind: 'vimeo', videoId: '123456', hash: '0d8c6fc8a5' } },
      { type: 'video', source: { kind: 'vimeo', videoId: '123456', hash: '0d8c6fc8a5' } },
      { type: 'video', source: { kind: 'vimeo', videoId: '123456', hash: null } },
    ]);
  });

  it('keeps Vimeo showcases and albums as bookmarks', async () => {
    const { run } = harness();
    const urls = ['https://vimeo.com/showcase/7891011', 'https://vimeo.com/album/123/video/456'];
    const nodes = await run(urls.map((url) => block('embed', { url, caption: [] })));
    expect(nodes).toMatchObject(urls.map((url) => ({ type: 'bookmark', url })));
  });

  it.each([404, 410])(
    'drops the poster of a YouTube video whose thumbnail is gone (HTTP %i) and warns',
    async (status) => {
      const { run, warnings } = harness(new MediaDownloadError(`HTTP ${status}`, { status }));
      const video = block('video', {
        type: 'external',
        external: { url: 'https://youtu.be/dQw4w9WgXcQ' },
        caption: [],
      });
      expect(await run([video])).toMatchObject([
        { type: 'video', source: { kind: 'youtube', videoId: 'dQw4w9WgXcQ', poster: null } },
      ]);
      expect(warnings).toEqual([expect.stringContaining(video.id)]);
      expect(warnings[0]).toContain(`HTTP ${status}`);
    },
  );

  it('fails when a YouTube poster still cannot be downloaded after retries', async () => {
    const { run } = harness(new MediaDownloadError('HTTP 503', { status: 503 }));
    const video = block('video', {
      type: 'external',
      external: { url: 'https://youtu.be/dQw4w9WgXcQ' },
      caption: [],
    });
    await expect(run([video])).rejects.toMatchObject({ name: 'MediaDownloadError', status: 503 });
  });

  it.each([
    ['bookmark', { url: '', caption: [] }],
    ['link_preview', { url: '' }],
    ['embed', { url: '', caption: [] }],
    ['image', { type: 'external', external: { url: '' }, caption: [] }],
    ['video', { type: 'external', external: { url: '' }, caption: [] }],
    ['audio', { type: 'external', external: { url: '' }, caption: [] }],
    ['file', { type: 'external', external: { url: '' }, caption: [], name: '' }],
    ['pdf', { type: 'external', external: { url: '' }, caption: [] }],
  ])('skips %s blocks without a URL and warns', async (type, data) => {
    const { run, warnings, ensured } = harness();
    const empty = block(type, data);
    expect(await run([empty])).toEqual([]);
    expect(ensured).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining(`"${type}" (${empty.id})`)]);
    expect(warnings[0]).toContain('no URL');
  });

  it('links to pages and skips other link targets', async () => {
    const { run, warnings } = harness();
    const toDatabase = block('link_to_page', { type: 'database_id', database_id: PAGE });
    const toComment = block('link_to_page', { type: 'comment_id', comment_id: PAGE });
    const nodes = await run([
      block('link_to_page', { type: 'page_id', page_id: '71d7802a-0abf-4857-a535-dfd861d8491e' }),
      block('child_page', { title: 'Sub page' }, { id: PAGE }),
      toDatabase,
      toComment,
    ]);
    expect(nodes).toMatchObject([
      { type: 'page_link', pageId: PAGE, title: '' },
      { type: 'page_link', pageId: PAGE, title: 'Sub page' },
    ]);
    expect(warnings).toEqual([
      expect.stringContaining(`database_id target in block ${toDatabase.id}`),
      expect.stringContaining(`comment_id target in block ${toComment.id}`),
    ]);
  });
});
