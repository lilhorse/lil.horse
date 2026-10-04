import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config';
import { getSiteData } from '../lib/content';
import { sitemapEntries, sitemapXml } from '../lib/sitemap';

export const GET: APIRoute = async () =>
  new Response(sitemapXml(sitemapEntries(await getSiteData(), siteConfig.url)), {
    headers: { 'Content-Type': 'application/xml' },
  });
