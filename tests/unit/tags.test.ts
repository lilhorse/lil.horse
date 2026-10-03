import { describe, expect, it } from 'vitest';
import { fnv1a, tagColor, tagHref, tagIndex, tagSlug } from '../../src/lib/tags';
import type { PostEntry } from '../../src/notion/types';

const post = (slug: string, published: string, tags: string[], extra: Partial<PostEntry> = {}) =>
  ({
    id: `${slug}-id`,
    slug,
    title: slug,
    status: 'Published',
    published,
    featured: false,
    tags,
    ...extra,
  }) as PostEntry;

describe('tagSlug', () => {
  it('uses the plain slug when slugging drops nothing, keeping CJK characters', () => {
    expect(tagSlug('AI')).toBe('ai');
    expect(tagSlug('Hello World')).toBe('hello-world');
    expect(tagSlug('中文 标签')).toBe('中文-标签');
    expect(tagSlug('豆瓣')).toBe('豆瓣');
    expect(tagSlug('under_score')).toBe('under_score');
  });

  it('ignores stray spaces', () => {
    expect(tagSlug('  spaced  ')).toBe('spaced');
  });

  it('adds a stable hash of the full name when slugging drops characters', () => {
    const hash = (name: string) => fnv1a(name).toString(16).padStart(8, '0').slice(0, 6);
    expect(tagSlug('C++')).toBe(`c-${hash('c++')}`);
    expect(tagSlug('C#')).toBe(`c-${hash('c#')}`);
    expect(tagSlug('C++')).not.toBe(tagSlug('C#'));
    expect(tagSlug('Node.js')).toMatch(/^nodejs-[0-9a-f]{6}$/);
    expect(tagSlug('🎬 Movies')).toMatch(/^movies-[0-9a-f]{6}$/);
    expect(tagSlug('🎬 Movies')).not.toBe(tagSlug('Movies'));
  });

  it('gives spellings a reader would call the same tag one slug', () => {
    expect(tagSlug('ai')).toBe(tagSlug('AI'));
    expect(tagSlug('\u{FF21}\u{FF29}')).toBe(tagSlug('AI'));
    expect(tagSlug('hello-world')).toBe(tagSlug('Hello World'));
    expect(tagSlug('c++')).toBe(tagSlug('C++'));
  });

  it('falls back to a stable hash when nothing survives slugging', () => {
    expect(tagSlug('🎬')).toMatch(/^tag-[0-9a-f]{6}$/);
    expect(tagSlug('🎬')).toBe(tagSlug('🎬'));
    expect(tagSlug('!!!')).not.toBe(tagSlug('🎬'));
  });
});

describe('tagHref and tagColor', () => {
  it('percent-encodes non-ASCII slugs', () => {
    expect(tagHref('中文-标签')).toBe('/blog/tags/%E4%B8%AD%E6%96%87-%E6%A0%87%E7%AD%BE');
    expect(tagHref('ai')).toBe('/blog/tags/ai');
  });

  it('picks a highlighter colour from the slug, the same everywhere', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(['yellow', 'pink', 'green', 'blue']).toContain(tagColor('ai'));
    expect(tagColor('ai')).toBe(tagColor(tagSlug('AI')));
  });
});

describe('tagIndex', () => {
  it('lists the posts of each tag, newest first, without unlisted posts', () => {
    const index = tagIndex([
      post('old', '2023-01-01', ['AI']),
      post('new', '2024-01-01', ['ai', 'Life']),
      post('hidden', '2024-06-01', ['secret', 'AI'], { status: 'Unlisted' }),
    ]);
    expect(index.map((tag) => [tag.slug, tag.posts.map((item) => item.slug)])).toEqual([
      ['ai', ['new', 'old']],
      ['life', ['new']],
    ]);
  });

  it('names a merged tag after its most used spelling', () => {
    const index = tagIndex([
      post('a', '2024-01-01', ['ai']),
      post('b', '2024-01-02', ['AI']),
      post('c', '2024-01-03', ['AI']),
    ]);
    expect(index[0]?.name).toBe('AI');
  });

  it('keeps tags that only slug alike on separate pages, never throwing', () => {
    const index = tagIndex([post('a', '2024-01-01', ['C++']), post('b', '2024-01-02', ['C#'])]);
    expect(index).toHaveLength(2);
    expect(index.map((tag) => tag.name).sort()).toEqual(['C#', 'C++']);
    expect(index.every((tag) => /^c-[0-9a-f]{6}$/.test(tag.slug))).toBe(true);
  });
});
