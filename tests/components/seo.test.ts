import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Analytics from '../../src/components/shell/Analytics.astro';
import StandalonePage from '../../src/components/StandalonePage.astro';
import { beaconLoader } from '../../src/lib/analytics';
import NotFound from '../../src/pages/404.astro';
import BlogPost from '../../src/pages/blog/[slug].astro';
import BlogIndex from '../../src/pages/blog/index.astro';
import Home from '../../src/pages/index.astro';
import { GET as robots } from '../../src/pages/robots.txt';
import { GET as sitemap } from '../../src/pages/sitemap-0.xml';
import { GET as sitemapIndex } from '../../src/pages/sitemap-index.xml';
import { htmlErrors, render } from '../helpers/astro-render';
import { content, post, profile, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

const page = (key: 'about' | 'contact') => ({
  id: key,
  key,
  title: key === 'about' ? 'About' : 'Contact',
  icon: null,
  cover: null,
  lastEditedTime: '2024-01-11T00:00:00.000Z',
  content: content(),
});

const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    ([, body]) => JSON.parse(body ?? '') as Record<string, unknown>,
  );

beforeEach(() => {
  useSite({
    posts: [post('douban', { tags: ['AI'], updated: '2024-02-10', published: '2024-01-11' })],
    pages: [page('about'), page('contact')],
    profile: { ...profile, github: 'lilhorse' },
  });
});

describe('head metadata', () => {
  it('describes a list page with the site image and no article data', async () => {
    const html = await render(BlogIndex, {}, 'https://lil.horse/blog.html');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:title" content="Blog">');
    expect(html).toContain('<meta property="og:url" content="https://lil.horse/blog">');
    expect(html).toContain(
      '<meta property="og:image" content="https://lil.horse/og/site/home.png">',
    );
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(
      '<meta name="twitter:image" content="https://lil.horse/og/site/home.png">',
    );
    expect(html).not.toContain('article:published_time');
    expect(jsonLd(html)).toEqual([]);
  });

  it('describes a post as an article with its own image, structured data and breadcrumbs', async () => {
    const html = await render(
      BlogPost,
      { post: post('douban', { tags: ['AI'], updated: '2024-02-10' }) },
      'https://lil.horse/blog/douban.html',
    );
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain(
      '<meta property="og:image" content="https://lil.horse/og/blog/douban.png">',
    );
    expect(html).toContain('<meta property="article:published_time" content="2024-01-11">');
    expect(html).toContain('<meta property="article:modified_time" content="2024-02-10">');
    expect(html).toContain('<meta property="article:tag" content="AI">');
    const [posting, crumbs] = jsonLd(html);
    expect(posting).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'Post douban',
      dateModified: '2024-02-10',
      keywords: 'AI',
    });
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList' });
    expect((crumbs?.itemListElement as unknown[]).length).toBe(3);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('adds the Person record to the home page and About, and keeps the 404 page out of indexes', async () => {
    expect(jsonLd(await render(Home))).toMatchObject([
      { '@type': 'Person', sameAs: ['https://github.com/lilhorse'] },
    ]);
    expect(jsonLd(await render(StandalonePage, { pageKey: 'about' }))).toMatchObject([
      { '@type': 'Person' },
    ]);
    expect(jsonLd(await render(StandalonePage, { pageKey: 'contact' }))).toEqual([]);
    expect(await render(StandalonePage, { pageKey: 'about' })).toContain(
      'content="https://lil.horse/og/pages/about.png"',
    );
    const missing = await render(NotFound, {}, 'https://lil.horse/404.html');
    expect(missing).toContain('<meta name="robots" content="noindex">');
    expect(missing).not.toContain('og:url');
  });
});

describe('Analytics', () => {
  it('renders the beacon loader only with a token', async () => {
    expect((await render(Analytics, { token: null })).trim()).toBe('');
    expect(await render(Analytics, { token: 'abc123' })).toBe(
      `<script>${beaconLoader('abc123')}</script>`,
    );
  });
});

describe('sitemap and robots endpoints', () => {
  it('serve the index, the url set and robots.txt', async () => {
    const index = await sitemapIndex({} as APIContext);
    expect(index.headers.get('content-type')).toBe('application/xml');
    expect(await index.text()).toContain('<loc>https://lil.horse/sitemap-0.xml</loc>');
    const urls = await (await sitemap({} as APIContext)).text();
    expect(urls).toContain(
      '<url><loc>https://lil.horse/blog/douban</loc><lastmod>2024-02-10</lastmod></url>',
    );
    expect(urls).toContain('<loc>https://lil.horse/blog/tags/ai</loc>');
    expect(urls).not.toContain('404');
    const text = await (await robots({} as APIContext)).text();
    expect(text).toBe('User-agent: *\nAllow: /\n\nSitemap: https://lil.horse/sitemap-index.xml\n');
  });
});
