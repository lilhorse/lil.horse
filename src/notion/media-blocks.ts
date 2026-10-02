import { basename } from 'node:path';
import type {
  AudioBlockObjectResponse,
  ChildPageBlockObjectResponse,
  EmbedBlockObjectResponse,
  FileBlockObjectResponse,
  ImageBlockObjectResponse,
  LinkToPageBlockObjectResponse,
  PdfBlockObjectResponse,
  RichTextItemResponse,
  VideoBlockObjectResponse,
} from '@notionhq/client';
import type { AstContext } from './ast';
import { normalizeId } from './ids';
import { MediaDownloadError, safeDecodeURIComponent } from './media';
import { plain, toRichText } from './rich-text';
import type { Node, VideoSource } from './types';

type FileContent =
  { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } };

// Playlist and live-stream embeds put these where a video ID would be.
const NON_VIDEO_IDS = new Set(['videoseries', 'live_stream']);

export function fileUrl(content: FileContent): string {
  return content.type === 'external' ? content.external.url : content.file.url;
}

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www\.|m\.)/, '');
    let id: string | null | undefined = null;
    if (host === 'youtu.be') id = parsed.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id =
        parsed.pathname === '/watch'
          ? parsed.searchParams.get('v')
          : /^\/(?:embed|shorts|live)\/([^/]+)/.exec(parsed.pathname)?.[1];
    }
    return id && /^[\w-]{6,}$/.test(id) && !NON_VIDEO_IDS.has(id) ? id : null;
  } catch {
    return null;
  }
}

export function vimeoVideo(url: string): { videoId: string; hash: string | null } | null {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    let videoId: string | undefined;
    let hash: string | null = null;
    if (hostname === 'player.vimeo.com') {
      videoId = /^\/video\/(\d+)\/?$/.exec(pathname)?.[1];
      hash = searchParams.get('h');
    } else if (hostname === 'vimeo.com' || hostname === 'www.vimeo.com') {
      const match = /^\/(?:(\d+)(?:\/([^/]+))?|channels\/[^/]+\/(\d+))\/?$/.exec(pathname);
      videoId = match?.[1] ?? match?.[3];
      hash = match?.[2] ?? null;
    }
    return videoId && (hash === null || /^[0-9a-f]+$/i.test(hash)) ? { videoId, hash } : null;
  } catch {
    return null;
  }
}

async function videoSource(
  blockId: string,
  url: string,
  external: boolean,
  ctx: AstContext,
): Promise<VideoSource> {
  if (!external) return { kind: 'file', media: await ctx.media.ensure(url, { kind: 'file' }) };
  const youtube = youtubeId(url);
  if (youtube) {
    const poster = await ctx.media
      .ensure(`https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`, { kind: 'image' })
      .catch((error: unknown) => {
        const status = error instanceof MediaDownloadError ? error.status : undefined;
        if (status !== 404 && status !== 410) throw error;
        ctx.warn(
          `Video ${blockId} has no YouTube poster (HTTP ${status}); the video may be private or removed`,
        );
        return null;
      });
    return { kind: 'youtube', videoId: youtube, poster };
  }
  const vimeo = vimeoVideo(url);
  if (vimeo) return { kind: 'vimeo', ...vimeo };
  return { kind: 'link', url };
}

function skipWithoutUrl(block: { id: string; type: string }, ctx: AstContext): null {
  ctx.warn(`Notion block "${block.type}" (${block.id}) has no URL; skipped`);
  return null;
}

export async function imageNode(
  block: ImageBlockObjectResponse,
  ctx: AstContext,
): Promise<Node | null> {
  const url = fileUrl(block.image);
  if (!url) return skipWithoutUrl(block, ctx);
  const caption = toRichText(block.image.caption);
  const alt = plain(caption).trim();
  if (!alt) ctx.warn(`Image ${block.id} has no caption; its alt text will be empty`);
  return {
    type: 'image',
    id: block.id,
    media: await ctx.media.ensure(url, { kind: 'image' }),
    caption,
    alt,
  };
}

export async function videoNode(
  block: VideoBlockObjectResponse,
  ctx: AstContext,
): Promise<Node | null> {
  const url = fileUrl(block.video);
  if (!url) return skipWithoutUrl(block, ctx);
  return {
    type: 'video',
    id: block.id,
    source: await videoSource(block.id, url, block.video.type === 'external', ctx),
    caption: toRichText(block.video.caption),
  };
}

export async function audioNode(
  block: AudioBlockObjectResponse,
  ctx: AstContext,
): Promise<Node | null> {
  const url = fileUrl(block.audio);
  if (!url) return skipWithoutUrl(block, ctx);
  return {
    type: 'audio',
    id: block.id,
    media: await ctx.media.ensure(url, { kind: 'file' }),
    caption: toRichText(block.audio.caption),
  };
}

export async function fileNode(
  block: FileBlockObjectResponse | PdfBlockObjectResponse,
  ctx: AstContext,
): Promise<Node | null> {
  const content = block.type === 'file' ? block.file : block.pdf;
  const url = fileUrl(content);
  if (!url) return skipWithoutUrl(block, ctx);
  const named = 'name' in content && typeof content.name === 'string' ? content.name.trim() : '';
  const name = named || safeDecodeURIComponent(basename(new URL(url).pathname)) || 'file';
  return {
    type: 'file',
    id: block.id,
    media: await ctx.media.ensure(url, { kind: 'file', fileNameHint: name }),
    name,
    caption: toRichText(content.caption),
  };
}

export async function bookmarkNode(
  block: { id: string; type: string },
  url: string,
  caption: RichTextItemResponse[],
  ctx: AstContext,
): Promise<Node | null> {
  if (!url) return skipWithoutUrl(block, ctx);
  return {
    type: 'bookmark',
    id: block.id,
    url,
    meta: await ctx.bookmarks.get(url),
    caption: toRichText(caption),
  };
}

export async function embedNode(
  block: EmbedBlockObjectResponse,
  ctx: AstContext,
): Promise<Node | null> {
  const { url, caption } = block.embed;
  if (youtubeId(url) || vimeoVideo(url)) {
    return {
      type: 'video',
      id: block.id,
      source: await videoSource(block.id, url, true, ctx),
      caption: toRichText(caption),
    };
  }
  return bookmarkNode(block, url, caption, ctx);
}

export function pageLinkNode(
  block: LinkToPageBlockObjectResponse | ChildPageBlockObjectResponse,
  ctx: AstContext,
): Node | null {
  if (block.type === 'child_page')
    return {
      type: 'page_link',
      id: block.id,
      pageId: normalizeId(block.id),
      title: block.child_page.title,
    };
  if (block.link_to_page.type === 'page_id') {
    return {
      type: 'page_link',
      id: block.id,
      pageId: normalizeId(block.link_to_page.page_id),
      title: '',
    };
  }
  ctx.warn(`Link to a ${block.link_to_page.type} target in block ${block.id} skipped`);
  return null;
}
