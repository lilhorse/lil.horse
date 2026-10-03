import { beforeEach, describe, expect, it, vi } from 'vitest';
import StandalonePage from '../../src/components/StandalonePage.astro';
import type { SiteData } from '../../src/lib/content';
import { excerpt } from '../../src/notion/text';
import type {
  PageContent,
  PostEntry,
  ProfileEntry,
  ProjectEntry,
  StandalonePageEntry,
} from '../../src/notion/types';
import NotFound from '../../src/pages/404.astro';
import BlogPost from '../../src/pages/blog/[slug].astro';
import BlogIndex from '../../src/pages/blog/index.astro';
import Home from '../../src/pages/index.astro';
import ProjectsIndex from '../../src/pages/projects/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';

const site = vi.hoisted(() => ({ data: undefined as unknown as SiteData }));

vi.mock('../../src/lib/content', () => ({ getSiteData: async () => site.data }));

const content = (overrides: Partial<PageContent> = {}): PageContent => ({
  blocks: [],
  headings: [],
  plainText: '',
  firstParagraph: null,
  hasMath: false,
  priorityImageId: null,
  childDataSourceIds: [],
  mediaKeys: [],
  linkedPageIds: [],
  ...overrides,
});

const post = (slug: string, overrides: Partial<PostEntry> = {}): PostEntry => ({
  id: `id-${slug}`,
  slug,
  title: `Post ${slug}`,
  status: 'Published',
  published: '2024-01-11',
  updated: null,
  tags: [],
  description: 'About it',
  language: 'en',
  featured: false,
  cover: null,
  lastEditedTime: '2024-01-11T00:00:00.000Z',
  readingMinutes: 2,
  content: content(),
  ...overrides,
});

const project = (name: string, overrides: Partial<ProjectEntry> = {}): ProjectEntry => ({
  id: `id-${name}`,
  name,
  slug: null,
  description: `${name} does things`,
  stack: [],
  link: 'https://example.com',
  repo: null,
  status: null,
  featured: false,
  order: null,
  year: null,
  cover: null,
  lastEditedTime: '2024-01-11T00:00:00.000Z',
  content: null,
  ...overrides,
});

const profile: ProfileEntry = {
  id: 'me',
  name: "Lil'Horse",
  role: 'Developer',
  location: 'Auckland',
  availability: 'Open to work',
  stack: [],
  email: null,
  github: null,
  x: null,
  bio: null,
};

function useSite(data: Partial<SiteData>) {
  site.data = {
    posts: [],
    projects: [],
    profile,
    pages: [],
    links: new Map(),
    resolve: () => undefined,
    ...data,
  };
}

const element = (html: string, start: string, tag: string) => {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  return html.slice(from, html.indexOf(`</${tag}>`, from) + tag.length + 3);
};

beforeEach(() => {
  useSite({});
});

describe('Base layout', () => {
  it('separates the navigation links', async () => {
    const html = await render(NotFound);
    expect(textOf(element(html, '<nav aria-label="Primary"', 'nav'))).toBe(
      '~/lil.horse blog projects about contact',
    );
  });
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
    const html = await render(BlogIndex);
    expect(textOf(element(html, '<li>', 'li'))).toBe('01-11 Post draft DRAFT #a #b');
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
    const item = element(await render(ProjectsIndex), '<li>', 'li');
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
