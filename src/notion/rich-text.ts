import type { RichTextItemResponse } from '@notionhq/client';
import { parseId } from './ids';
import type { Annotations, RichText, RichTextSpan } from './types';

export function pageIdFromHref(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//')) return parseId(href);
  try {
    return /(^|\.)notion\.(so|site|com)$/.test(new URL(href).hostname) ? parseId(href) : null;
  } catch {
    return null;
  }
}

function annotationsOf(item: RichTextItemResponse): Annotations {
  const { bold, italic, strikethrough, underline, code, color } = item.annotations;
  return { bold, italic, strikethrough, underline, code, color };
}

function toSpan(item: RichTextItemResponse): RichTextSpan {
  const annotations = annotationsOf(item);
  if (item.type === 'equation')
    return { kind: 'equation', expression: item.equation.expression, annotations };
  if (item.type === 'mention') {
    const value = item.mention;
    if (value.type === 'date') {
      return {
        kind: 'date',
        text: item.plain_text,
        start: value.date.start,
        end: value.date.end ?? null,
        annotations,
      };
    }
    if (value.type === 'page')
      return {
        kind: 'text',
        text: item.plain_text,
        annotations,
        href: null,
        pageId: parseId(value.page.id),
      };
    if (value.type === 'database') {
      return {
        kind: 'text',
        text: item.plain_text,
        annotations,
        href: null,
        pageId: parseId(value.database.id),
      };
    }
    return {
      kind: 'text',
      text: item.plain_text,
      annotations,
      href: item.href,
      pageId: pageIdFromHref(item.href),
    };
  }
  const href = item.text.link?.url ?? item.href ?? null;
  return { kind: 'text', text: item.text.content, annotations, href, pageId: pageIdFromHref(href) };
}

export function toRichText(items: RichTextItemResponse[]): RichText {
  return items.map(toSpan);
}

export function plain(text: RichText): string {
  return text.map((span) => (span.kind === 'equation' ? span.expression : span.text)).join('');
}

export function isBlank(text: RichText): boolean {
  return plain(text).trim() === '';
}
