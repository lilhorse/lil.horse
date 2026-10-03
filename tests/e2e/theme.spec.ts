import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    pref: document.documentElement.dataset.themePref,
    metas: [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
      meta.getAttribute('content'),
    ),
  }));

test('cycles system, light and dark, and keeps the choice after a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  expect(await state(page)).toEqual({
    theme: 'light',
    pref: 'system',
    metas: ['#e6e9ef', '#16161e'],
  });
  const toggle = page.locator('[data-theme-toggle]');
  await expect(toggle).toHaveText('Theme: system', { useInnerText: true });
  await toggle.click();
  expect(await state(page)).toEqual({
    theme: 'light',
    pref: 'light',
    metas: ['#e6e9ef', '#e6e9ef'],
  });
  await expect(toggle).toHaveText('Theme: light', { useInnerText: true });
  await toggle.click();
  expect(await state(page)).toEqual({ theme: 'dark', pref: 'dark', metas: ['#16161e', '#16161e'] });
  await expect(toggle).toHaveText('Theme: dark', { useInnerText: true });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(26, 27, 38)',
  );
  await page.reload();
  expect(await state(page)).toMatchObject({ theme: 'dark', pref: 'dark' });
  await toggle.click();
  expect(await state(page)).toEqual({
    theme: 'light',
    pref: 'system',
    metas: ['#e6e9ef', '#16161e'],
  });
});

test('applies a stored theme from <head>, before the body renders', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/blog');
  const html = await page.content();
  const script = html.indexOf('let p="system"');
  expect(script).toBeGreaterThan(0);
  expect(script).toBeLessThan(html.indexOf('<body'));
  expect(await state(page)).toMatchObject({ theme: 'dark', pref: 'dark' });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(26, 27, 38)',
  );
});

test('follows the system while the preference is system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => state(page)).toMatchObject({ theme: 'dark', pref: 'system' });
  await page.locator('[data-theme-toggle]').click();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await state(page)).toMatchObject({ theme: 'light', pref: 'light' });
});
