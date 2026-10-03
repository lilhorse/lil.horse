import katex from 'katex';
import { plain } from '../notion/rich-text';
import type {
  DatabaseNode,
  ListNode,
  MediaRef,
  Node,
  PostEntry,
  RichText,
  TableNode,
  VideoNode,
} from '../notion/types';
import type { SiteData } from './content';
import {
  escapeAttr,
  escapeHtml,
  formatBytes,
  isSafeHref,
  linkHtml,
  renderCell,
  renderRichText,
  type LinkResolver,
} from './html';
import { KATEX_OPTIONS } from './katex';

export const FEED_LIMIT = 20;

export interface FeedItem {
  title: string;
  link: string;
  pubDate: Date;
  description?: string;
  categories: string[];
  content: string;
}

interface FeedContext {
  resolve: LinkResolver;
}

// Text and attribute values are escaped, so raw '<' and '>' only ever delimit tags.
const START_TAG = /<[a-z][^>]*>/gi;
const URL_ATTRIBUTE = /\b(href|src|poster)="([^"]*)"/g;
const SRCSET = /\bsrcset="([^"]*)"/g;

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Readers show the item far from the site, so every link and image needs its full address. */
export function absolutizeHtml(html: string, base: string): string {
  return html.replace(START_TAG, (tag) =>
    tag
      .replace(
        URL_ATTRIBUTE,
        (_, name: string, value: string) => `${name}="${absolute(value, base)}"`,
      )
      .replace(SRCSET, (_, value: string) => {
        const candidates = value.split(',').map((candidate) => {
          const [url = '', size] = candidate.trim().split(/\s+/);
          return [absolute(url, base), size].filter(Boolean).join(' ');
        });
        return `srcset="${candidates.join(', ')}"`;
      }),
  );
}

function rich(text: RichText, ctx: FeedContext): string {
  return renderRichText(text, ctx.resolve, { math: 'mathml' });
}

function caption(text: RichText, ctx: FeedContext): string {
  return text.length > 0 ? `<figcaption>${rich(text, ctx)}</figcaption>` : '';
}

function image(media: MediaRef, alt: string): string {
  const src =
    media.variants.filter((variant) => variant.format === 'webp').at(-1)?.src ?? media.src;
  const size =
    media.width && media.height ? ` width="${media.width}" height="${media.height}"` : '';
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${size}>`;
}

function list(node: ListNode, ctx: FeedContext): string {
  const tag = node.style === 'numbered' ? 'ol' : 'ul';
  const items = node.items.map((item) => {
    const box = node.style === 'todo' ? (item.checked ? '☑ ' : '☐ ') : '';
    return `<li>${box}${rich(item.text, ctx)}${renderFeedNodes(item.children, ctx)}</li>`;
  });
  return `<${tag}>${items.join('')}</${tag}>`;
}

function table(node: TableNode, ctx: FeedContext): string {
  const [first, ...rest] = node.rows;
  const body = node.columnHeader ? rest : node.rows;
  const head =
    node.columnHeader && first
      ? `<thead><tr>${first.map((cell) => `<th scope="col">${rich(cell, ctx)}</th>`).join('')}</tr></thead>`
      : '';
  const rows = body.map(
    (row) =>
      `<tr>${row
        .map((cell, index) =>
          node.rowHeader && index === 0
            ? `<th scope="row">${rich(cell, ctx)}</th>`
            : `<td>${rich(cell, ctx)}</td>`,
        )
        .join('')}</tr>`,
  );
  return `<table>${head}<tbody>${rows.join('')}</tbody></table>`;
}

function database(node: DatabaseNode, ctx: FeedContext): string {
  const head = node.columns.map((column) => `<th scope="col">${escapeHtml(column.name)}</th>`);
  const rows = node.rows.map(
    (row) =>
      `<tr>${node.columns
        .map((column) => `<td>${renderCell(row.cells[column.id], ctx.resolve)}</td>`)
        .join('')}</tr>`,
  );
  return `<figure><figcaption>${escapeHtml(node.title)}</figcaption><table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></figure>`;
}

function video(node: VideoNode, ctx: FeedContext): string {
  const { source } = node;
  const label = (where: string) => {
    const title = plain(node.caption).trim();
    return escapeHtml(title ? `Watch on ${where}: ${title}` : `Watch on ${where}`);
  };
  switch (source.kind) {
    case 'youtube':
      return `<p>${linkHtml(`https://www.youtube.com/watch?v=${encodeURIComponent(source.videoId)}`, label('YouTube'))}</p>`;
    case 'vimeo': {
      const hash = source.hash ? `/${encodeURIComponent(source.hash)}` : '';
      return `<p>${linkHtml(`https://vimeo.com/${encodeURIComponent(source.videoId)}${hash}`, label('Vimeo'))}</p>`;
    }
    case 'file':
      return `<figure><video controls src="${escapeAttr(source.media.src)}"></video>${caption(node.caption, ctx)}</figure>`;
    case 'link':
      return `<p>${isSafeHref(source.url) ? linkHtml(source.url, escapeHtml(source.url)) : escapeHtml(source.url)}</p>`;
  }
}

/** The post body as plain, self-contained HTML: no scripts, classes or styles to depend on. */
export function renderFeedNodes(nodes: Node[], ctx: FeedContext): string {
  return nodes.map((node) => renderFeedNode(node, ctx)).join('');
}

function renderFeedNode(node: Node, ctx: FeedContext): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${rich(node.text, ctx)}</p>${renderFeedNodes(node.children, ctx)}`;
    case 'heading':
      return `<h${node.level}>${rich(node.text, ctx)}</h${node.level}>${renderFeedNodes(node.children, ctx)}`;
    case 'list':
      return list(node, ctx);
    case 'quote':
      return `<blockquote><p>${rich(node.text, ctx)}</p>${renderFeedNodes(node.children, ctx)}</blockquote>`;
    case 'callout': {
      const icon = node.icon?.kind === 'emoji' ? `${escapeHtml(node.icon.emoji)} ` : '';
      return `<aside><p>${icon}${rich(node.text, ctx)}</p>${renderFeedNodes(node.children, ctx)}</aside>`;
    }
    case 'toggle':
      return `<details><summary>${rich(node.summary, ctx)}</summary>${renderFeedNodes(node.children, ctx)}</details>`;
    case 'divider':
      return '<hr>';
    case 'code':
      return `<figure><pre><code class="language-${escapeAttr(node.language)}">${escapeHtml(node.code)}</code></pre>${caption(node.caption, ctx)}</figure>`;
    case 'equation':
      return katex.renderToString(node.expression, {
        ...KATEX_OPTIONS,
        output: 'mathml',
        displayMode: true,
      });
    case 'image':
      return `<figure>${image(node.media, node.alt)}${caption(node.caption, ctx)}</figure>`;
    case 'video':
      return video(node, ctx);
    case 'audio':
      return `<figure><audio controls src="${escapeAttr(node.media.src)}"></audio>${caption(node.caption, ctx)}</figure>`;
    case 'file':
      return `<p>${linkHtml(node.media.src, escapeHtml(node.name))} (${formatBytes(node.media.bytes)})</p>`;
    case 'bookmark': {
      const title = escapeHtml(node.meta?.title ?? node.url);
      const description = node.meta?.description ? ` — ${escapeHtml(node.meta.description)}` : '';
      return `<p>${isSafeHref(node.url) ? linkHtml(node.url, title) : title}${description}</p>`;
    }
    case 'table':
      return table(node, ctx);
    case 'columns':
      return node.columns.map((column) => renderFeedNodes(column.children, ctx)).join('');
    case 'database':
      return database(node, ctx);
    case 'page_link': {
      const target = ctx.resolve(node.pageId);
      return target ? `<p>${linkHtml(target.url, escapeHtml(target.title))}</p>` : '';
    }
    case 'container':
      return renderFeedNodes(node.children, ctx);
    case 'toc':
    case 'unsupported':
      return '';
  }
}

export function feedContent(post: PostEntry, resolve: LinkResolver, siteUrl: string): string {
  return absolutizeHtml(
    renderFeedNodes(post.content.blocks, { resolve }),
    `${siteUrl}/blog/${post.slug}`,
  );
}

/** The newest Published posts, in full. */
export function feedItems(site: Pick<SiteData, 'posts' | 'resolve'>, siteUrl: string): FeedItem[] {
  return site.posts
    .filter((post) => post.status === 'Published')
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, FEED_LIMIT)
    .map((post) => ({
      title: post.title,
      link: `/blog/${post.slug}`,
      pubDate: new Date(post.published),
      ...(post.description ? { description: post.description } : {}),
      categories: post.tags,
      content: feedContent(post, site.resolve, siteUrl),
    }));
}
