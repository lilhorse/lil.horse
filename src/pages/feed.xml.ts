import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config';
import { getSiteData } from '../lib/content';
import { feedItems } from '../lib/feed';

export const GET: APIRoute = async () => {
  const site = await getSiteData();
  return rss({
    title: siteConfig.name,
    description: site.profile.bio ?? `${site.profile.role} in ${site.profile.location}`,
    site: siteConfig.url,
    trailingSlash: false,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: [
      '<language>en</language>',
      "<copyright>Content © Lil'Horse, licensed under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)</copyright>",
      `<atom:link href="${siteConfig.url}/feed.xml" rel="self" type="application/rss+xml"/>`,
    ].join(''),
    items: feedItems(site, siteConfig.url),
  });
};
