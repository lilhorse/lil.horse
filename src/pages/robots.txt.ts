import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config';
import { robotsTxt } from '../lib/sitemap';

export const GET: APIRoute = () =>
  new Response(robotsTxt(siteConfig.url), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
