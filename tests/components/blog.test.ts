import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlogIndex from '../../src/pages/blog/index.astro';
import TagPage from '../../src/pages/blog/tags/[tag].astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { element, post, siteState, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('blog index', () => {
  it('groups titles by year and links tags to their pages', async () => {
    useSite({ posts: [post('draft', { status: 'Draft', tags: ['a', 'b'] })] });
    const html = await render(BlogIndex);
    expect(html).toContain('<h1 class="sr-only">Blog</h1>');
    expect(textOf(element(html, '<h2 id="year-2024"', 'h2'))).toBe('── 2024');
    expect(textOf(element(html, '<ul class="posts titles"', 'section'))).toBe(
      '01-11 Post draft DRAFT #a #b',
    );
    expect(html).toMatch(
      /<a href="\/blog\/tags\/a"><span class="pill tag-\w+"[^>]*>#a<\/span><\/a>/,
    );
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('prints total 0 when there are no posts', async () => {
    expect(textOf(element(await render(BlogIndex), '<p class="empty"', 'p'))).toBe('total 0');
  });
});

describe('tag pages', () => {
  it('lists the posts of a tag with full dates under a grep command', async () => {
    useSite({ posts: [post('one', { tags: ['豆瓣'] }), post('two', { tags: ['other'] })] });
    const tag = siteState.data.tags.find((entry) => entry.name === '豆瓣');
    const html = await render(TagPage, { tag });
    expect(html).toContain('<h1 class="sr-only">Posts tagged #豆瓣</h1>');
    expect(html).toMatch(/grep -r (&quot;|&#34;|")#豆瓣(&quot;|&#34;|") ~\/blog/);
    expect(textOf(element(html, '<ul class="posts titles"', 'section'))).toBe(
      '2024-01-11 Post one #豆瓣',
    );
    expect(html).toContain('href="/blog/tags/%E8%B1%86%E7%93%A3"');
    expect(await htmlErrors(html)).toEqual([]);
  });
});
