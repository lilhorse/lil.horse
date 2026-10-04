import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pagePaths } from './site';

const SITE = 'https://lil.horse';

const structuredData = (page: Page) =>
  page.$$eval('script[type="application/ld+json"]', (scripts) =>
    scripts.map((script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>),
  );

async function indexablePaths(request: APIRequestContext): Promise<string[]> {
  const paths: string[] = [];
  for (const path of pagePaths()) {
    const html = await (await request.get(encodeURI(path))).text();
    if (!html.includes('<meta name="robots" content="noindex">')) paths.push(path);
  }
  return paths;
}

test('every page names itself for sharing and points at an image that exists', async ({
  page,
  request,
}) => {
  for (const path of pagePaths()) {
    await page.goto(encodeURI(path));
    const meta = await page.evaluate(() => ({
      title: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      image: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      card: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    }));
    expect(meta.title, path).toBeTruthy();
    expect(meta.card, path).toBe('summary_large_image');
    expect(meta.canonical, path).toBe(`${SITE}${path === '/' ? '/' : encodeURI(path)}`);
    expect(meta.image, path).toMatch(/^https:\/\/lil\.horse\/og\/.+\.png$/);
    const image = await request.get((meta.image ?? '').replace(SITE, ''));
    expect(image.status(), path).toBe(200);
    expect(image.headers()['content-type'], path).toBe('image/png');
  }
});

test('posts carry article data, structured data and breadcrumbs', async ({ page }) => {
  await page.goto('/');
  const [person] = await structuredData(page);
  expect(person?.['@type']).toBe('Person');
  const post = pagePaths().find((path) => /^\/blog\/[^/]+$/.test(path)) ?? '';
  expect(post).not.toBe('');
  await page.goto(encodeURI(post));
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  const title = await page.locator('meta[property="og:title"]').getAttribute('content');
  const data = await structuredData(page);
  expect(data.map((item) => item['@type'])).toEqual(['BlogPosting', 'BreadcrumbList']);
  expect(data[0]).toMatchObject({
    headline: title,
    url: canonical,
    image: `${SITE}/og/blog/${post.split('/').pop()}.png`,
    author: { '@type': 'Person', name: person?.name },
  });
  const crumbs = data[1]?.itemListElement as { item: string }[];
  expect(crumbs.map((crumb) => crumb.item)).toEqual([SITE, `${SITE}/blog`, canonical]);
  await expect(page.locator('meta[property="article:published_time"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
});

test('robots.txt points at a sitemap that lists every indexable page', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
  const index = await (await request.get('/sitemap-index.xml')).text();
  expect(index).toContain(`<loc>${SITE}/sitemap-0.xml</loc>`);
  const urls = await (await request.get('/sitemap-0.xml')).text();
  const entries = [
    ...urls.matchAll(
      /<url><loc>https:\/\/lil\.horse([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g,
    ),
  ].map(([, path = '', lastmod]) => ({ path: decodeURIComponent(path), lastmod }));
  expect(entries.map((entry) => entry.path).sort()).toEqual((await indexablePaths(request)).sort());
  for (const { path, lastmod } of entries) {
    if (/^\/blog\/[^/]+$/.test(path)) expect(lastmod, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    else expect(lastmod, path).toBeUndefined();
  }
});
