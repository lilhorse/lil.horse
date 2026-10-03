import { expect, test } from '@playwright/test';
import { pagePaths } from './site';

test('serves a 1200 × 630 share image for the home page, every post and both standalone pages', async ({
  request,
}) => {
  const posts = pagePaths().filter((path) => /^\/blog\/[^/]+$/.test(path));
  const images = [
    '/og/site/home.png',
    '/og/pages/about.png',
    '/og/pages/contact.png',
    ...posts.map((path) => `/og/blog/${path.split('/').pop()}.png`),
  ];
  expect(images.length).toBeGreaterThan(3);
  for (const path of images) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toBe('image/png');
    const png = await response.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([1200, 630]);
  }
});
