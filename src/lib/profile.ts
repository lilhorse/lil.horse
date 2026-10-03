import type { ProfileEntry } from '../notion/types';
import { isSafeHref } from './html';

export interface SocialLink {
  label: string;
  href: string;
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
