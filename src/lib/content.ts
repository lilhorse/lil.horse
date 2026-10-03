import { getCollection, getEntry } from 'astro:content';
import type { PostEntry, ProfileEntry, ProjectEntry, StandalonePageEntry } from '../notion/types';
import type { LinkResolver } from './html';
import { buildLinkMap, type LinkTarget } from './links';
import { sortProjects } from './selectors';

export interface SiteData {
  posts: PostEntry[];
  projects: ProjectEntry[];
  profile: ProfileEntry;
  pages: StandalonePageEntry[];
  links: Map<string, LinkTarget>;
  resolve: LinkResolver;
}

let cached: Promise<SiteData> | undefined;

async function load(): Promise<SiteData> {
  const posts = (await getCollection('posts'))
    .map((entry) => entry.data as PostEntry)
    .sort((a, b) => b.published.localeCompare(a.published));
  const projects = sortProjects(
    (await getCollection('projects')).map((entry) => entry.data as ProjectEntry),
  );
  const profile = await getEntry('profile', 'profile');
  if (!profile) throw new Error('The profile collection is empty');
  const pages = (await getCollection('pages')).map((entry) => entry.data as StandalonePageEntry);
  const links = buildLinkMap({ posts, projects, pages });
  return {
    posts,
    projects,
    profile: profile.data as ProfileEntry,
    pages,
    links,
    resolve: (pageId) => links.get(pageId),
  };
}

export function getSiteData(): Promise<SiteData> {
  cached ??= load().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
