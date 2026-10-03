import type { SiteData } from './content';

export type OgType = 'site' | 'blog' | 'projects' | 'pages';

export interface OgTarget {
  type: OgType;
  slug: string;
  title: string;
  command: string;
  path: string;
  meta: string[];
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

export function ogImagePath(type: OgType, slug: string): string {
  return `/og/${type}/${slug}.png`;
}

/** Satori draws boxes for emoji it has no font for, so titles lose them before rendering. */
export function stripEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** One image per page that can be shared: the home page, every post, project pages, About and Contact. */
export function ogTargets(
  site: Pick<SiteData, 'posts' | 'projects' | 'pages' | 'profile'>,
): OgTarget[] {
  const { profile } = site;
  const home: OgTarget = {
    type: 'site',
    slug: 'home',
    title: profile.name,
    command: 'neofetch',
    path: '~/lil.horse',
    meta: [profile.role, profile.location],
  };
  const posts = site.posts.map((post): OgTarget => ({
    type: 'blog',
    slug: post.slug,
    title: post.title,
    command: `cat ~/blog/${post.slug}.md`,
    path: `~/blog/${post.slug}.md`,
    meta: [post.published, ...post.tags.map((tag) => `#${tag}`)],
  }));
  const projects = site.projects
    .filter((project) => project.slug && project.content)
    .map((project): OgTarget => ({
      type: 'projects',
      slug: project.slug ?? '',
      title: project.name,
      command: `cat ~/projects/${project.slug}.md`,
      path: `~/projects/${project.slug}.md`,
      meta: [...(project.year ? [String(project.year)] : []), ...project.stack],
    }));
  const pages = site.pages.map((page): OgTarget => ({
    type: 'pages',
    slug: page.key,
    title: page.title,
    command: `cat ~/${page.key}.md`,
    path: `~/${page.key}.md`,
    meta: [],
  }));
  return [home, ...posts, ...projects, ...pages];
}
