import { expect, test } from './fixtures';
import { pagePaths } from './site';

test('serves a full-text RSS 2.0 feed with absolute addresses', async ({ request }) => {
  const response = await request.get('/feed.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('xml');
  const xml = await response.text();
  expect(xml).toContain('<rss version="2.0"');
  const posts = [...xml.matchAll(/<link>https:\/\/lil\.horse(\/blog\/[^<]+)<\/link>/g)].map(
    ([, path = '']) => decodeURI(path),
  );
  expect(posts.length, 'post links').toBeGreaterThan(0);
  expect(pagePaths()).toEqual(expect.arrayContaining(posts));
  expect(xml).toContain('<content:encoded>');
  expect(xml).toContain('<copyright>');
  expect(xml).not.toMatch(/<link>[^<]*\.html<\/link>/);
  expect(xml).not.toMatch(/<link>[^<]*\/<\/link>/);
  expect(xml).not.toContain('href="/');
  expect(xml).not.toContain('src="/');
  // The post HTML inside <content:encoded> is escaped, quotes included.
  expect(xml).not.toContain('href=&quot;/');
  expect(xml).not.toContain('src=&quot;/');
});

test('announces the feed in every page head', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute(
    'href',
    '/feed.xml',
  );
  await expect(page.locator('footer a[href="/feed.xml"]')).toHaveText('rss');
});
