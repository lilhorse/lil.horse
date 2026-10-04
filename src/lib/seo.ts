import type { PostEntry, ProfileEntry } from '../notion/types';
import { ogImagePath } from './og';
import { socialLinks } from './profile';

export type JsonLd = Record<string, unknown>;

export function absoluteUrl(path: string, site: string): string {
  return new URL(path, site).toString();
}

/** JSON for a <script> body: "<" is escaped so no value can close the element early. */
export function jsonLdHtml(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function personJsonLd(profile: ProfileEntry, site: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.role,
    url: site,
    sameAs: socialLinks(profile).map((link) => link.href),
  };
}

export function blogPostingJsonLd(post: PostEntry, profile: ProfileEntry, site: string): JsonLd {
  const url = absoluteUrl(`/blog/${post.slug}`, site);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    ...(post.description ? { description: post.description } : {}),
    url,
    mainEntityOfPage: url,
    datePublished: post.published,
    dateModified: post.updated ?? post.published,
    author: { '@type': 'Person', name: profile.name, url: site },
    image: absoluteUrl(ogImagePath('blog', post.slug), site),
    inLanguage: post.language === 'zh' ? 'zh-Hans' : 'en',
    ...(post.tags.length > 0 ? { keywords: post.tags.join(', ') } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
