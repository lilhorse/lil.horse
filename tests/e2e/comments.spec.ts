import { expect, test } from './fixtures';

test('loads Giscus only once the comments come near, with the current theme', async ({ page }) => {
  await page.route('https://giscus.app/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/blog/douban');
  const section = page.locator('[data-comments]');
  const script = page.locator('script[src="https://giscus.app/client.js"]');
  const far = await section.evaluate(
    (element) => element.getBoundingClientRect().top > window.innerHeight + 600,
  );
  if (far) await expect(script).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute('data-term', 'douban');
  await expect(script).toHaveAttribute('data-mapping', 'specific');
  await expect(script).toHaveAttribute('data-strict', '1');
  await expect(script).toHaveAttribute('data-repo-id', 'R_kgDOGbvmeg');
  await expect(script).toHaveAttribute('data-theme', 'https://lil.horse/giscus/night.css');
});

test('serves both theme stylesheets with the header giscus asks for', async ({ request }) => {
  for (const name of ['night', 'mist']) {
    const response = await request.get(`/giscus/${name}.css`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()['content-type'], name).toContain('text/css');
    expect(response.headers()['access-control-allow-origin'], name).toBe('https://giscus.app');
    expect(await response.text()).toContain('--color-canvas-default:');
  }
});
