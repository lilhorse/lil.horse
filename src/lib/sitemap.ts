import type { SiteData } from './content';
import { escapeHtml } from './html';
import { listedPosts } from './selectors';
import { absoluteUrl } from './seo';
import { tagHref } from './tags';

export interface SitemapEntry {
  url: string;
  lastmod?: string;
}

/** Every indexable page: lists, standalone pages, listed posts (with their edit dates), project pages and tags. */
export function sitemapEntries(
  site: Pick<SiteData, 'posts' | 'projects' | 'pages' | 'tags'>,
  siteUrl: string,
): SitemapEntry[] {
  const at = (path: string) => absoluteUrl(path, siteUrl);
  return [
    { url: at('/') },
    { url: at('/blog') },
    { url: at('/projects') },
    ...site.pages.map((page) => ({ url: at(`/${page.key}`) })),
    ...listedPosts(site.posts).map((post) => ({
      url: at(`/blog/${post.slug}`),
      lastmod: post.updated ?? post.published,
    })),
    ...site.projects
      .filter((project) => project.slug && project.content)
      .map((project) => ({ url: at(`/projects/${project.slug}`) })),
    ...site.tags.map((tag) => ({ url: at(tagHref(tag.slug)) })),
  ];
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map(
    (entry) =>
      `<url><loc>${escapeHtml(entry.url)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function sitemapIndexXml(siteUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<sitemap><loc>${absoluteUrl('/sitemap-0.xml', siteUrl)}</loc></sitemap>\n</sitemapindex>\n`;
}

export function robotsTxt(siteUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap-index.xml', siteUrl)}\n`;
}
