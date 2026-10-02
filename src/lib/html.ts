import { domainToUnicode } from 'node:url';
import katex from 'katex';
import type { DbCell, MediaRef, RichText, RichTextSpan } from '../notion/types';
import { KATEX_OPTIONS } from './katex';
import type { LinkTarget } from './links';

export type LinkResolver = (pageId: string) => LinkTarget | undefined;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function isSafeHref(href: string): boolean {
  // Browsers read '\' as '/', so '/\host' is as off-site as '//host'.
  return /^(https?:|mailto:|tel:)/i.test(href) || /^\/(?![/\\])/.test(href) || href.startsWith('#');
}

export function colorClass(color: string): string {
  return color.endsWith('_background')
    ? `hl-${color.slice(0, -'_background'.length)}`
    : `c-${color}`;
}

export function hostnameOf(url: string): string {
  try {
    return domainToUnicode(new URL(url).hostname).replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (Math.round(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function renderSpan(span: RichTextSpan, resolve: LinkResolver): string {
  if (span.kind === 'equation') {
    return katex.renderToString(span.expression, { ...KATEX_OPTIONS, displayMode: false });
  }
  let html =
    span.kind === 'date'
      ? `<time datetime="${escapeAttr(span.start)}">${escapeHtml(span.text)}</time>`
      : escapeHtml(span.text).replace(/\n/g, '<br>');
  const { annotations } = span;
  if (annotations.code) html = `<code>${html}</code>`;
  if (annotations.bold) html = `<strong>${html}</strong>`;
  if (annotations.italic) html = `<em>${html}</em>`;
  if (annotations.strikethrough) html = `<s>${html}</s>`;
  if (annotations.underline) html = `<u>${html}</u>`;
  if (annotations.color !== 'default')
    html = `<span class="${colorClass(annotations.color)}">${html}</span>`;
  if (span.kind === 'text') {
    const target = span.pageId ? resolve(span.pageId) : undefined;
    if (target) html = `<a href="${escapeAttr(target.url)}">${html}</a>`;
    else if (!span.pageId && span.href && isSafeHref(span.href))
      html = `<a href="${escapeAttr(span.href)}" rel="noopener noreferrer">${html}</a>`;
  }
  return html;
}

export function renderRichText(text: RichText, resolve: LinkResolver): string {
  return text.map((span) => renderSpan(span, resolve)).join('');
}

function thumbnail(media: MediaRef): string {
  const src = media.variants.find((variant) => variant.format === 'webp')?.src ?? media.src;
  const width = 64;
  const height =
    media.width && media.height ? Math.round((media.height / media.width) * width) : width;
  return `<img src="${escapeAttr(src)}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async">`;
}

export function renderCell(cell: DbCell | undefined, resolve: LinkResolver): string {
  if (!cell) return '';
  switch (cell.kind) {
    case 'empty':
      return '';
    case 'text':
      return renderRichText(cell.text, resolve);
    case 'chips':
      return cell.values
        .map(
          (value) =>
            `<span class="chip ${colorClass(value.color)}">${escapeHtml(value.name)}</span>`,
        )
        .join(' ');
    case 'date': {
      const start = `<time datetime="${escapeAttr(cell.start)}">${escapeHtml(cell.start)}</time>`;
      return cell.end
        ? `${start} → <time datetime="${escapeAttr(cell.end)}">${escapeHtml(cell.end)}</time>`
        : start;
    }
    case 'number':
      return escapeHtml(String(cell.value));
    case 'checkbox':
      return cell.value
        ? '<span role="img" aria-label="Yes">✓</span>'
        : '<span role="img" aria-label="No">–</span>';
    case 'url':
      return isSafeHref(cell.url)
        ? `<a href="${escapeAttr(cell.url)}" rel="noopener noreferrer">${escapeHtml(hostnameOf(cell.url))}</a>`
        : escapeHtml(cell.url);
    case 'media':
      return cell.items.map(thumbnail).join('');
    case 'stars':
      return `<span class="stars" role="img" aria-label="${cell.value} out of 5">${'★'.repeat(cell.value)}${'☆'.repeat(5 - cell.value)}</span>`;
  }
}
