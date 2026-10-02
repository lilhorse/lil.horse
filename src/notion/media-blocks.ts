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
import { plain, toRichText } from './rich-text';
import type { Node, VideoSource } from './types';

type FileContent =
  { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } };

export function fileUrl(content: FileContent): string {
  return content.type === 'external' ? content.external.url : content.file.url;
}

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www\.|m\.)/, '');
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    return /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function vimeoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)vimeo\.com$/.test(parsed.hostname)) return null;
    return /\/(?:video\/)?(\d+)/.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function videoSource(url: string, external: boolean, ctx: AstContext): Promise<VideoSource> {
  if (!external) return { kind: 'file', media: await ctx.media.ensure(url, { kind: 'file' }) };
  const youtube = youtubeId(url);
  if (youtube) {
    const poster = await ctx.media
      .ensure(`https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`, { kind: 'image' })
      .catch(() => null);
    return { kind: 'youtube', videoId: youtube, poster };
  }
  const vimeo = vimeoId(url);
  if (vimeo) return { kind: 'vimeo', videoId: vimeo };
  return { kind: 'link', url };
}

export async function imageNode(block: ImageBlockObjectResponse, ctx: AstContext): Promise<Node> {
  const caption = toRichText(block.image.caption);
  const alt = plain(caption).trim();
  if (!alt) ctx.warn(`Image ${block.id} has no caption; its alt text will be empty`);
  return {
    type: 'image',
    id: block.id,
    media: await ctx.media.ensure(fileUrl(block.image), { kind: 'image' }),
    caption,
    alt,
  };
}

export async function videoNode(block: VideoBlockObjectResponse, ctx: AstContext): Promise<Node> {
  return {
    type: 'video',
    id: block.id,
    source: await videoSource(fileUrl(block.video), block.video.type === 'external', ctx),
    caption: toRichText(block.video.caption),
  };
}

export async function audioNode(block: AudioBlockObjectResponse, ctx: AstContext): Promise<Node> {
  return {
    type: 'audio',
    id: block.id,
    media: await ctx.media.ensure(fileUrl(block.audio), { kind: 'file' }),
    caption: toRichText(block.audio.caption),
  };
}

export async function fileNode(
  block: FileBlockObjectResponse | PdfBlockObjectResponse,
  ctx: AstContext,
): Promise<Node> {
  const content = block.type === 'file' ? block.file : block.pdf;
  const url = fileUrl(content);
  const named = 'name' in content && typeof content.name === 'string' ? content.name.trim() : '';
  const name = named || decodeURIComponent(basename(new URL(url).pathname)) || 'file';
  return {
    type: 'file',
    id: block.id,
    media: await ctx.media.ensure(url, { kind: 'file', fileNameHint: name }),
    name,
    caption: toRichText(content.caption),
  };
}

export async function bookmarkNode(
  id: string,
  url: string,
  caption: RichTextItemResponse[],
  ctx: AstContext,
): Promise<Node> {
  return {
    type: 'bookmark',
    id,
    url,
    meta: await ctx.bookmarks.get(url),
    caption: toRichText(caption),
  };
}

export async function embedNode(block: EmbedBlockObjectResponse, ctx: AstContext): Promise<Node> {
  const { url, caption } = block.embed;
  if (youtubeId(url) || vimeoId(url)) {
    return {
      type: 'video',
      id: block.id,
      source: await videoSource(url, true, ctx),
      caption: toRichText(caption),
    };
  }
  return bookmarkNode(block.id, url, caption, ctx);
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
