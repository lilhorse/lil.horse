import type { PostEntry, ProjectEntry } from '../notion/types';
import { hostnameOf } from './html';

const COLLATOR = new Intl.Collator('zh');

const byPublishedDesc = (a: PostEntry, b: PostEntry) =>
  b.published.localeCompare(a.published) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

export function listedPosts(posts: PostEntry[]): PostEntry[] {
  return posts.filter((post) => post.status !== 'Unlisted').sort(byPublishedDesc);
}

export function homePosts(posts: PostEntry[], limit = 5): PostEntry[] {
  const listed = listedPosts(posts);
  return [
    ...listed.filter((post) => post.featured),
    ...listed.filter((post) => !post.featured),
  ].slice(0, limit);
}

export function postsByYear(posts: PostEntry[]): { year: string; posts: PostEntry[] }[] {
  const groups = new Map<string, PostEntry[]>();
  for (const post of listedPosts(posts)) {
    const year = post.published.slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), post]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, items]) => ({ year, posts: items }));
}

export function adjacentPosts(
  posts: PostEntry[],
  slug: string,
): { previous: PostEntry | null; next: PostEntry | null } {
  const listed = listedPosts(posts);
  const index = listed.findIndex((post) => post.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return { previous: listed[index + 1] ?? null, next: listed[index - 1] ?? null };
}

export function sortProjects(projects: ProjectEntry[]): ProjectEntry[] {
  return [...projects].sort(
    (a, b) =>
      (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
      COLLATOR.compare(a.name, b.name),
  );
}

export function featuredProjects(projects: ProjectEntry[], limit = 4): ProjectEntry[] {
  return sortProjects(projects)
    .filter((project) => project.featured)
    .slice(0, limit);
}

export function projectHref(project: ProjectEntry): string | null {
  if (project.content && project.slug) return `/projects/${project.slug}`;
  return project.link ?? project.repo ?? null;
}

export function adjacentProjects(
  projects: ProjectEntry[],
  slug: string,
): { previous: ProjectEntry | null; next: ProjectEntry | null } {
  const pages = sortProjects(projects).filter((project) => project.content && project.slug);
  const index = pages.findIndex((project) => project.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return { previous: pages[index - 1] ?? null, next: pages[index + 1] ?? null };
}

/** The project's live site and repository, minus whichever the card's title already links to. */
export function projectLinks(project: ProjectEntry): { label: string; href: string }[] {
  const primary = projectHref(project);
  const links: { label: string; href: string }[] = [];
  if (project.link && project.link !== primary)
    links.push({ label: hostnameOf(project.link), href: project.link });
  if (project.repo && project.repo !== primary) links.push({ label: 'source', href: project.repo });
  return links;
}
