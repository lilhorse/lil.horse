import { slug } from 'github-slugger';
import type { PostEntry } from '../notion/types';
import { listedPosts } from './selectors';

export type TagColor = 'yellow' | 'pink' | 'green' | 'blue';

export interface TagInfo {
  slug: string;
  name: string;
  color: TagColor;
  posts: PostEntry[];
}

const COLORS: readonly TagColor[] = ['yellow', 'pink', 'green', 'blue'];
// A slug becomes a file name, and file names are limited to 255 bytes.
const MAX_SLUG_BYTES = 100;

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const tidy = (text: string) => text.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
const shortHash = (text: string) => fnv1a(text).toString(16).padStart(8, '0').slice(0, 6);
// encodeInto writes whole code points only.
const clip = (text: string, bytes: number) =>
  text.slice(0, new TextEncoder().encodeInto(text, new Uint8Array(bytes)).read);

export function tagSlug(name: string): string {
  const key = name.normalize('NFKC').trim().toLowerCase();
  const full = tidy(slug(key));
  if (!full) return `tag-${shortHash(key)}`;
  const base = tidy(clip(full, MAX_SLUG_BYTES));
  // A slug that dropped characters could equal another tag's, so it carries a hash of the full name.
  return base === full && base === tidy(key.replace(/\s+/g, '-'))
    ? base
    : `${base}-${shortHash(key)}`;
}

export function tagHref(tag: string): string {
  return `/blog/tags/${encodeURIComponent(tag)}`;
}

export function tagColor(tag: string): TagColor {
  return COLORS[fnv1a(tag) % COLORS.length] ?? 'yellow';
}

/** One entry per tag used by a listed post; spellings that share a slug share a page. */
export function tagIndex(posts: PostEntry[]): TagInfo[] {
  const listed = listedPosts(posts);
  const spellings = new Map<string, Map<string, number>>();
  for (const post of listed) {
    for (const name of post.tags) {
      const key = tagSlug(name);
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      spellings.set(key, counts);
    }
  }
  const index: TagInfo[] = [];
  for (const [key, counts] of spellings) {
    const name = [...counts.keys()]
      .sort()
      .reduce((best, candidate) =>
        (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best,
      );
    const tagged = listed.filter((post) => post.tags.some((tag) => tagSlug(tag) === key));
    index.push({ slug: key, name, color: tagColor(key), posts: tagged });
  }
  return index.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
