import { describe, expect, it } from 'vitest';
import { buildLinkMap } from '../../src/lib/links';
import {
  adjacentPosts,
  featuredProjects,
  homePosts,
  postsByYear,
  projectHref,
  sortProjects,
} from '../../src/lib/selectors';
import type {
  PageContent,
  PostEntry,
  ProjectEntry,
  StandalonePageEntry,
} from '../../src/notion/types';

const content = {} as PageContent;
const post = (slug: string, published: string, extra: Partial<PostEntry> = {}) =>
  ({
    id: `${slug}-id`,
    slug,
    title: slug,
    status: 'Published',
    published,
    featured: false,
    ...extra,
  }) as PostEntry;
const project = (name: string, extra: Partial<ProjectEntry> = {}) =>
  ({
    id: `${name}-id`,
    name,
    slug: null,
    content: null,
    link: null,
    repo: null,
    featured: false,
    order: null,
    ...extra,
  }) as ProjectEntry;

const posts = [
  post('newest', '2024-03-01'),
  post('secret', '2024-02-15', { status: 'Unlisted' }),
  post('douban', '2024-02-29'),
  post('pinned', '2023-06-01', { featured: true }),
  post('hello', '2024-01-11'),
];

describe('post selectors', () => {
  it('puts featured posts first and hides unlisted ones', () => {
    expect(homePosts(posts, 3).map((item) => item.slug)).toEqual(['pinned', 'newest', 'douban']);
  });

  it('groups listed posts by year, newest first', () => {
    expect(
      postsByYear(posts).map((group) => [group.year, group.posts.map((item) => item.slug)]),
    ).toEqual([
      ['2024', ['newest', 'douban', 'hello']],
      ['2023', ['pinned']],
    ]);
  });

  it('finds the older and newer neighbours', () => {
    expect(adjacentPosts(posts, 'douban')).toMatchObject({
      previous: { slug: 'hello' },
      next: { slug: 'newest' },
    });
    expect(adjacentPosts(posts, 'secret')).toEqual({ previous: null, next: null });
  });

  it('orders same-day posts by slug, whatever the input order', () => {
    const alpha = post('alpha', '2024-05-01');
    const beta = post('beta', '2024-05-01');
    for (const input of [
      [alpha, beta],
      [beta, alpha],
    ]) {
      expect(homePosts(input).map((item) => item.slug)).toEqual(['alpha', 'beta']);
      expect(adjacentPosts(input, 'alpha')).toMatchObject({
        previous: { slug: 'beta' },
        next: null,
      });
    }
  });
});

describe('project selectors', () => {
  it('links to the detail page, then the live link, then the repo', () => {
    expect(projectHref(project('a', { slug: 'a', content }))).toBe('/projects/a');
    expect(
      projectHref(project('b', { link: 'https://b.dev', repo: 'https://github.com/x/b' })),
    ).toBe('https://b.dev');
    expect(projectHref(project('c', { repo: 'https://github.com/x/c' }))).toBe(
      'https://github.com/x/c',
    );
    expect(projectHref(project('d'))).toBeNull();
  });

  it('sorts by order with blanks last, then by name, and keeps featured ones', () => {
    const sorted = sortProjects([
      project('zeta'),
      project('beta', { order: 2 }),
      project('alpha'),
      project('gamma', { order: 1, featured: true }),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(['gamma', 'beta', 'alpha', 'zeta']);
    expect(featuredProjects(sorted).map((item) => item.name)).toEqual(['gamma']);
  });

  it('breaks order ties between CJK names in pinyin order', () => {
    const xiaoma = project('小马', { order: 1 });
    const biji = project('笔记', { order: 1 });
    for (const input of [
      [xiaoma, biji],
      [biji, xiaoma],
    ]) {
      expect(sortProjects(input).map((item) => item.name)).toEqual(['笔记', '小马']);
    }
  });
});

describe('buildLinkMap', () => {
  it('maps published pages to their site URLs', () => {
    const map = buildLinkMap({
      posts: [post('hello', '2024-01-11')],
      projects: [project('site', { slug: 'site', content }), project('tool')],
      pages: [{ id: 'about-id', key: 'about', title: 'About' } as StandalonePageEntry],
    });
    expect(Object.fromEntries([...map].map(([id, target]) => [id, target.url]))).toEqual({
      'hello-id': '/blog/hello',
      'site-id': '/projects/site',
      'about-id': '/about',
    });
  });
});
