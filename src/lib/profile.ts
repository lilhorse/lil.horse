import type { ProfileEntry } from '../notion/types';
import { escapeHtml, isSafeHref } from './html';

/** The stack row's note from site.config.ts: whether to strike every item, and a comment after them. */
export interface StackNote {
  strikethrough: boolean;
  text?: string;
}

export interface SocialLink {
  label: string;
  href: string;
}

/** The address as HTML with comments around "@", so the source never holds it in plain text. */
export function emailHtml(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return `${escapeHtml(email.slice(0, at))}<!-- -->@<!-- -->${escapeHtml(email.slice(at + 1))}`;
}

function profileUrl(value: string | null, base: string): string | null {
  const handle = value?.trim() ?? '';
  if (!handle) return null;
  if (/^https?:\/\//i.test(handle)) return isSafeHref(handle) ? handle : null;
  const name = handle.replace(/^@/, '');
  return /^[\w.-]+$/.test(name) ? `${base}${name}` : null;
}

export function socialLinks(profile: Pick<ProfileEntry, 'github' | 'x'>): SocialLink[] {
  const links: SocialLink[] = [];
  const github = profileUrl(profile.github, 'https://github.com/');
  const x = profileUrl(profile.x, 'https://x.com/');
  if (github) links.push({ label: 'github', href: github });
  if (x) links.push({ label: 'x', href: x });
  return links;
}
