import { describe, expect, it } from 'vitest';
import PostList from '../../src/components/shell/PostList.astro';
import TagList from '../../src/components/shell/TagList.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { post } from '../helpers/site-data';

describe('TagList', () => {
  it('links tags that have a page and colours each by its slug', async () => {
    const html = await render(TagList, { tags: ['AI', 'secret'], linked: new Set(['ai']) });
    expect(html).toMatch(
      /<li><a href="\/blog\/tags\/ai"><span class="pill tag-(yellow|pink|green|blue)" data-pagefind-filter="tag\[data-tag\]" data-tag="AI">#AI<\/span><\/a><\/li>/,
    );
    expect(html).toMatch(
      /<li><span class="pill tag-\w+" data-pagefind-filter="tag\[data-tag\]" data-tag="secret">#secret<\/span><\/li>/,
    );
    expect(textOf(html)).toBe('#AI #secret');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('renders nothing without tags', async () => {
    expect((await render(TagList, { tags: [], linked: new Set() })).trim()).toBe('');
  });
});

describe('PostList', () => {
  it('lists files with dates, the draft marker and tags', async () => {
    const html = await render(PostList, {
      posts: [post('douban', { tags: ['life'], status: 'Draft', published: '2024-02-29' })],
      tags: new Set(['life']),
      variant: 'files',
    });
    expect(textOf(html)).toBe('2024-02-29 douban.md DRAFT #life');
    expect(html).toContain('<a href="/blog/douban">douban.md</a>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('lists titles with month and day', async () => {
    const html = await render(PostList, {
      posts: [post('douban', { published: '2024-02-29' })],
      tags: new Set(),
      variant: 'titles',
      date: 'month-day',
    });
    expect(textOf(html)).toBe('02-29 Post douban');
    expect(html).toContain('<time datetime="2024-02-29">02-29</time>');
  });

  it('prints total 0 for an empty list', async () => {
    const html = await render(PostList, { posts: [], tags: new Set(), variant: 'titles' });
    expect(textOf(html)).toBe('total 0');
  });
});
