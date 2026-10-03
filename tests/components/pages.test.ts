import { beforeEach, describe, expect, it, vi } from 'vitest';
import StandalonePage from '../../src/components/StandalonePage.astro';
import { excerpt } from '../../src/notion/text';
import type { StandalonePageEntry } from '../../src/notion/types';
import BlogPost from '../../src/pages/blog/[slug].astro';
import BlogIndex from '../../src/pages/blog/index.astro';
import Home from '../../src/pages/index.astro';
import ProjectsIndex from '../../src/pages/projects/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { content, element, post, project, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('home page', () => {
  it('lists posts with their date, draft marker and tags', async () => {
    useSite({
      posts: [
        post('draft', { status: 'Draft', published: '2024-03-01', tags: ['wip'] }),
        post('hello', { tags: ['helloworld', 'AI'] }),
      ],
    });
    const html = await render(Home);
    const items = element(html, '<section aria-labelledby="posts-heading"', 'section')
      .split('<li>')
      .slice(1)
      .map(textOf);
    expect(items).toEqual([
      '2024-03-01 Post draft DRAFT #wip',
      '2024-01-11 Post hello #helloworld #AI',
    ]);
    expect(html).toContain('<span class="tag">#AI</span>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('leaves out the projects section when no project is featured', async () => {
    useSite({ projects: [project('Quiet')] });
    expect(await render(Home)).not.toContain('projects-heading');
    useSite({ projects: [project('Loud', { featured: true })] });
    expect(await render(Home)).toContain('<h2 id="projects-heading">Projects</h2>');
  });
});

describe('blog pages', () => {
  it('separates the title, draft marker and tags in the list', async () => {
    useSite({ posts: [post('draft', { status: 'Draft', tags: ['a', 'b'] })] });
    const main = (await render(BlogIndex)).split('<main')[1] ?? '';
    expect(textOf(element(main, '<li>', 'li'))).toBe('01-11 Post draft DRAFT #a #b');
  });

  it('separates the meta line and the adjacent links of a post', async () => {
    const posts = [
      post('new', { published: '2024-03-01' }),
      post('middle', { published: '2024-02-01', tags: ['helloworld', 'AI'] }),
      post('old', { published: '2024-01-01' }),
    ];
    useSite({ posts });
    const html = await render(BlogPost, { post: posts[1] });
    expect(textOf(element(html, '<p><time', 'p'))).toBe('2024-02-01 · 2 min read #helloworld #AI');
    expect(textOf(element(html, '<nav aria-label="Adjacent posts"', 'nav'))).toBe(
      'Older: Post old Newer: Post new',
    );
  });
});

describe('projects page', () => {
  it('separates the name, year and status', async () => {
    useSite({ projects: [project('CleanStay', { year: 2026, status: 'Active' })] });
    const main = (await render(ProjectsIndex)).split('<main')[1] ?? '';
    const item = element(main, '<li>', 'li');
    expect(textOf(item.slice(0, item.indexOf('<p>')))).toBe('CleanStay 2026 Active');
  });
});

describe('standalone pages', () => {
  it('truncates the first paragraph for the meta description', async () => {
    const firstParagraph = `${'word '.repeat(60)}end`;
    const page: StandalonePageEntry = {
      id: 'about',
      key: 'about',
      title: 'About',
      icon: null,
      cover: null,
      lastEditedTime: '2024-01-11T00:00:00.000Z',
      content: content({ firstParagraph }),
    };
    useSite({ pages: [page] });
    const html = await render(StandalonePage, { pageKey: 'about' });
    const description = /<meta name="description" content="([^"]*)">/.exec(html)?.[1];
    expect(description).toBe(excerpt(firstParagraph));
    expect(description).toMatch(/…$/);
  });
});
