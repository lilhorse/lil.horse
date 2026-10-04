import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config';
import { sitemapIndexXml } from '../lib/sitemap';

export const GET: APIRoute = () =>
  new Response(sitemapIndexXml(siteConfig.url), { headers: { 'Content-Type': 'application/xml' } });
