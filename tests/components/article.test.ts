import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdjacentNav from '../../src/components/shell/AdjacentNav.astro';
import TableOfContents from '../../src/components/shell/TableOfContents.astro';
import BlogPost from '../../src/pages/blog/[slug].astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { content, element, heading, post, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('TableOfContents', () => {
  it('draws a tree, nesting skipped levels under the nearest parent', async () => {
    const html = await render(TableOfContents, {
      headings: [heading('A'), heading('Deep', 5), heading('A1', 3), heading('B')],
    });
    expect(html).toContain('<nav class="toc" aria-label="On this page">');
    expect(html).toContain(
      '<ul><li><a href="#a">A</a><ul><li><a href="#deep">Deep</a></li><li><a href="#a1">A1</a></li></ul></li><li><a href="#b">B</a></li></ul>',
    );
    expect(await htmlErrors(html)).toEqual([]);
  });
});

describe('AdjacentNav', () => {
  it('renders nothing without neighbours and one link with one', async () => {
    const props = { label: 'Adjacent posts', previousLabel: 'older', nextLabel: 'newer' };
    expect((await render(AdjacentNav, { ...props, previous: null, next: null })).trim()).toBe('');
    const html = await render(AdjacentNav, {
      ...props,
      previous: { href: '/blog/old', title: 'Old' },
      next: null,
    });
    expect(textOf(html)).toBe('‹ older Old');
    expect(html).toContain('<a class="previous" href="/blog/old" rel="prev">');
  });
});

describe('post page', () => {
  it('shows the meta line, the title, the updated date and the neighbours', async () => {
    const posts = [
      post('new', { published: '2024-03-01' }),
      post('middle', {
        published: '2024-02-01',
        tags: ['helloworld', 'AI'],
        updated: '2024-02-10',
      }),
      post('old', { published: '2024-01-01' }),
    ];
    useSite({ posts });
    const html = await render(BlogPost, { post: posts[1] });
    expect(html).toContain('cat ~/blog/middle.md');
    expect(textOf(element(html, '<div class="doc-meta"', 'div'))).toBe(
      '2024-02-01 · 2 min read · #helloworld #AI',
    );
    expect(html).toContain('<span class="tab active">middle.md</span>');
    expect(textOf(element(html, '<h1 class="title"', 'h1'))).toBe('# Post middle');
    expect(textOf(element(html, '<p class="doc-updated"', 'p'))).toBe('Updated 2024-02-10');
    expect(textOf(element(html, '<nav class="adjacent"', 'nav'))).toBe(
      '‹ older Post old newer › Post new',
    );
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('marks Chinese posts and drafts', async () => {
    const draft = post('zh', { language: 'zh', status: 'Draft' });
    useSite({ posts: [draft] });
    const html = await render(BlogPost, { post: draft });
    expect(html).toContain('<article class="doc-main" lang="zh-Hans">');
    expect(html).toContain('<span class="draft">DRAFT</span>');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('marks Published posts for the search index and leaves the others out', async () => {
    const published = post('pub', { tags: ['AI'], updated: '2024-02-10' });
    const unlisted = post('hidden', { status: 'Unlisted' });
    useSite({ posts: [published, unlisted] });
    const html = await render(BlogPost, { post: published });
    expect(html).toContain(
      '<article class="doc-main" lang="en" data-pagefind-body data-pagefind-meta="type:post">',
    );
    expect(html).toContain('<p class="command" aria-hidden="true" data-pagefind-ignore>');
    expect(html).toContain('data-pagefind-meta="title[data-title]" data-title="Post pub"');
    expect(html).toContain('<div class="doc-meta" data-pagefind-ignore>');
    expect(html).toContain('<time datetime="2024-01-11" data-pagefind-meta="date">');
    expect(html).toContain('data-pagefind-filter="tag[data-tag]" data-tag="AI"');
    expect(html).toContain('<p class="doc-updated" data-pagefind-ignore>');
    expect(await render(BlogPost, { post: unlisted })).not.toContain('data-pagefind-body');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('adds the tree outline only for three or more headings', async () => {
    const two = post('two', { content: content({ headings: [heading('A'), heading('B')] }) });
    const three = post('three', {
      content: content({ headings: [heading('A'), heading('A1', 3), heading('B')] }),
    });
    useSite({ posts: [two, three] });
    expect(await render(BlogPost, { post: two })).not.toContain('aria-label="On this page"');
    expect(await render(BlogPost, { post: three })).toContain('<div class="doc-toc">');
  });
});
