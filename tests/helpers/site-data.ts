import { expect } from 'vitest';
import type { SiteData } from '../../src/lib/content';
import { tagIndex } from '../../src/lib/tags';
import type {
  HeadingRef,
  PageContent,
  PostEntry,
  ProfileEntry,
  ProjectEntry,
} from '../../src/notion/types';

/** Read by the getSiteData mock that each page test installs with vi.mock. */
export const siteState = { data: undefined as unknown as SiteData };

export const content = (overrides: Partial<PageContent> = {}): PageContent => ({
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

export const post = (slug: string, overrides: Partial<PostEntry> = {}): PostEntry => ({
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

export const project = (name: string, overrides: Partial<ProjectEntry> = {}): ProjectEntry => ({
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

export const profile: ProfileEntry = {
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

export const heading = (text: string, level: HeadingRef['level'] = 2): HeadingRef => ({
  anchor: text.toLowerCase(),
  text,
  level,
});

export function useSite(data: Partial<SiteData> = {}): void {
  const tags = tagIndex(data.posts ?? []);
  siteState.data = {
    posts: [],
    projects: [],
    profile,
    pages: [],
    links: new Map(),
    resolve: () => undefined,
    tags,
    tagSlugs: new Set(tags.map((tag) => tag.slug)),
    ...data,
  };
}

/** The markup from the first occurrence of start up to the first closing tag after it. */
export function element(html: string, start: string, tag: string): string {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  return html.slice(from, html.indexOf(`</${tag}>`, from) + tag.length + 3);
}
