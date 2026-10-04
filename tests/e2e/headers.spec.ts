import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pagePaths, settle } from './site';

const head = (request: APIRequestContext, path: string) => request.get(path, { maxRedirects: 0 });

/** Records the CSP violations each document reports; call `collect` before leaving a page. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (event) =>
      seen.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
      ),
    );
  });
  const violations: string[] = [];
  const collect = async (label: string) => {
    const found = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    violations.push(...found.map((entry) => `${label}: ${entry}`));
  };
  return { violations, collect };
}

test('redirects the old addresses once, with 301, and nothing else', async ({ request }) => {
  const rules = readFileSync('dist/_redirects', 'utf8').trim().split('\n');
  const idRule = rules.find((rule) => /^\/[0-9a-f]{32} /.test(rule));
  expect(idRule).toBeDefined();
  const [from = '', to = ''] = (idRule ?? '').split(' ');
  for (const [path, location] of [
    ['/helloworld', '/blog/helloworld'],
    ['/douban', '/blog/douban'],
    ['/feed', '/feed.xml'],
    ['/blog/', '/blog'],
    ['/helloworld/', '/helloworld'],
    [from, to],
  ]) {
    const response = await head(request, path);
    expect(response.status(), path).toBe(301);
    expect(response.headers().location, path).toBe(location);
  }
  expect((await head(request, '/')).status()).toBe(200);
  expect((await head(request, '/HELLOWORLD')).status()).toBe(404);
  expect((await head(request, '/blog/helloworld')).status()).toBe(200);
});

test('sends the security headers everywhere and long caches only for hashed files', async ({
  request,
}) => {
  const page = (await head(request, '/')).headers();
  expect(page['content-security-policy']).toMatch(
    /^default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' 'sha256-/,
  );
  expect(page['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(page['x-content-type-options']).toBe('nosniff');
  expect(page['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(page['strict-transport-security']).toBe('max-age=31536000');
  expect(page['cache-control']).toBeUndefined();
  expect((await head(request, '/no-such-page')).headers()['x-content-type-options']).toBe(
    'nosniff',
  );

  const css = readdirSync('dist/_astro').find((file) => file.endsWith('.css')) ?? '';
  expect((await head(request, `/_astro/${css}`)).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
  expect((await head(request, '/og/site/home.png')).headers()['cache-control']).toBe(
    'public, max-age=86400',
  );
  expect((await head(request, '/pagefind/pagefind.js')).headers()['cache-control']).toBeUndefined();
  const media = readdirSync('dist/_media', { recursive: true, encoding: 'utf8' }).find((file) =>
    /\.(webp|avif|png|jpg|svg)$/.test(file),
  );
  test.skip(!media, 'the build has no media');
  const sandboxed = (await head(request, `/_media/${media}`)).headers();
  expect(sandboxed['content-security-policy']).toBe(
    "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
  );
  test.skip(!existsSync('dist/pagefind/index'), 'the build has no search index');
  const index = readdirSync('dist/pagefind/index')[0] ?? '';
  expect((await head(request, `/pagefind/index/${index}`)).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
});

test('no page violates the policy', async ({ page }) => {
  const { violations, collect } = await watchViolations(page);
  for (const path of [...pagePaths(), '/no-such-page']) {
    await page.goto(encodeURI(path));
    await settle(page);
    await collect(path);
  }
  expect(violations).toEqual([]);
});

test('no interaction violates the policy', async ({ page }) => {
  test.skip(!existsSync('dist/pagefind/index'), 'the build has no search index');
  const { violations, collect } = await watchViolations(page);
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search posts, pages and commands' }).fill('Schindler');
  await expect(page.locator('[data-results] [role="option"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-theme-toggle]').click();
  await page.keyboard.press('Shift+?');
  await collect('interactions');
  expect(violations).toEqual([]);
});
