import type { PostEntry, ProjectEntry, StandalonePageEntry } from '../notion/types';

export interface LinkTarget {
  url: string;
  title: string;
}

export function buildLinkMap(content: {
  posts: PostEntry[];
  projects: ProjectEntry[];
  pages: StandalonePageEntry[];
}): Map<string, LinkTarget> {
  const map = new Map<string, LinkTarget>();
  for (const post of content.posts)
    map.set(post.id, { url: `/blog/${post.slug}`, title: post.title });
  for (const project of content.projects) {
    if (project.content && project.slug)
      map.set(project.id, { url: `/projects/${project.slug}`, title: project.name });
  }
  for (const entry of content.pages)
    map.set(entry.id, { url: `/${entry.key}`, title: entry.title });
  return map;
}
