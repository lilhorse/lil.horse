import { domainToUnicode } from 'node:url';
import katex from 'katex';
import type { DbCell, MediaRef, NotionColor, RichText, RichTextSpan } from '../notion/types';
import { KATEX_OPTIONS } from './katex';
import type { LinkTarget } from './links';

export type LinkResolver = (pageId: string) => LinkTarget | undefined;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripTabsAndNewlines(href: string): string {
  return href.replace(/[\t\n\r]/g, '');
}

export function isSafeHref(href: string): boolean {
  // Browsers drop tabs and newlines and read '\' as '/', so '/\n/host' and '/\host' mean '//host'.
  const url = stripTabsAndNewlines(href);
  return /^(https?:|mailto:|tel:)/i.test(url) || /^\/(?![/\\])/.test(url) || url.startsWith('#');
}

/** Like colorClass, but the default text and background colours get no class. */
export function toneClass(color: NotionColor): string | undefined {
  return color === 'default' || color === 'default_background' ? undefined : colorClass(color);
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

/** The rel of a link: external web pages get no opener or referrer; site, mailto and tel links get none. */
export function relFor(href: string): string | undefined {
  // Scheme-relative: '//host', or '/\host' as browsers read it.
  return /^(https?:|[/\\]{2})/i.test(stripTabsAndNewlines(href))
    ? 'noopener noreferrer'
    : undefined;
}

export function linkHtml(href: string, inner: string): string {
  const rel = relFor(href);
  return `<a href="${escapeAttr(href)}"${rel ? ` rel="${rel}"` : ''}>${inner}</a>`;
}

function spanHref(span: RichTextSpan, resolve: LinkResolver): string | null {
  if (span.kind !== 'text') return null;
  if (span.pageId) return resolve(span.pageId)?.url ?? null;
  return span.href && isSafeHref(span.href) ? span.href : null;
}

function renderSpan(span: RichTextSpan): string {
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
  const tone = toneClass(annotations.color);
  if (tone) html = `<span class="${tone}">${html}</span>`;
  return html;
}

/** Notion splits a link wherever its formatting changes; spans that share a target become one link. */
export function renderRichText(text: RichText, resolve: LinkResolver): string {
  let html = '';
  let index = 0;
  while (index < text.length) {
    const span = text[index] as RichTextSpan;
    const href = spanHref(span, resolve);
    if (!href) {
      html += renderSpan(span);
      index += 1;
      continue;
    }
    let inner = '';
    while (index < text.length && spanHref(text[index] as RichTextSpan, resolve) === href) {
      inner += renderSpan(text[index] as RichTextSpan);
      index += 1;
    }
    html += linkHtml(href, inner);
  }
  return html;
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
        .map((value) => {
          const tone = toneClass(value.color);
          return `<span class="${tone ? `chip ${tone}` : 'chip'}">${escapeHtml(value.name)}</span>`;
        })
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
        ? linkHtml(cell.url, escapeHtml(hostnameOf(cell.url)))
        : escapeHtml(cell.url);
    case 'media':
      return cell.items.map(thumbnail).join('');
    case 'stars':
      return `<span class="stars" role="img" aria-label="${cell.value} out of 5">${'★'.repeat(cell.value)}${'☆'.repeat(5 - cell.value)}</span>`;
  }
}
