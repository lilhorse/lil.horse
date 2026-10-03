import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteData } from '../../src/lib/content';
import type { PageContent, PostEntry, ProfileEntry } from '../../src/notion/types';
import Home from '../../src/pages/index.astro';
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
});
