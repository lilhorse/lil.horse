import { describe, expect, it } from 'vitest';
import PostList from '../../src/components/shell/PostList.astro';
import TagList from '../../src/components/shell/TagList.astro';
import { tagSlug } from '../../src/lib/tags';
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

  it('marks a tag name with Chinese characters as Chinese', async () => {
    const html = await render(TagList, {
      tags: ['AI', '豆瓣', 'AI绘画'],
      linked: new Set([tagSlug('豆瓣')]),
    });
    const pills = (html.match(/<span class="pill[^>]*>[^<]*<\/span>/g) ?? []).map((pill) => [
      />#([^<]*)</.exec(pill)?.[1],
      /\slang="([^"]*)"/.exec(pill)?.[1] ?? null,
    ]);
    expect(pills).toEqual([
      ['AI', null],
      ['豆瓣', 'zh-Hans'],
      ['AI绘画', 'zh-Hans'],
    ]);
    expect(await htmlErrors(html)).toEqual([]);
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

  it('lists titles with month and day, marking Chinese titles', async () => {
    const html = await render(PostList, {
      posts: [
        post('douban', { published: '2024-02-29' }),
        post('zh', { published: '2024-01-15', language: 'zh', title: '我的豆瓣备份' }),
      ],
      tags: new Set(),
      variant: 'titles',
      date: 'month-day',
    });
    expect(textOf(html)).toContain('02-29 Post douban');
    expect(textOf(html)).toContain('01-15 我的豆瓣备份');
    expect(html).toContain('<time datetime="2024-02-29">02-29</time>');
    expect(html).toContain('<a href="/blog/douban">Post douban</a>');
    expect(html).toContain('<a href="/blog/zh" lang="zh-Hans">我的豆瓣备份</a>');
  });

  it('leaves file names without a lang, whatever the post language', async () => {
    const html = await render(PostList, {
      posts: [post('zh', { language: 'zh' })],
      tags: new Set(),
      variant: 'files',
    });
    expect(html).toContain('<a href="/blog/zh">zh.md</a>');
  });

  it('prints total 0 for an empty list', async () => {
    const html = await render(PostList, { posts: [], tags: new Set(), variant: 'titles' });
    expect(textOf(html)).toBe('total 0');
  });
});
