import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { builtFromFixtures } from './site';

const typing = (page: Page) => page.locator('.slogan-typed');

/** Checked once, without retrying: typing that had started would still be running. */
const typingNow = (page: Page) =>
  page.evaluate(() => ({
    overlays: document.querySelectorAll('.slogan-typed').length,
    hidden: document.querySelector('.slogan')?.classList.contains('typing'),
  }));

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  test.skip((await page.locator('[data-slogan]').count()) === 0, 'the root page has no slogan');
}

test('the banner is an image named by the title in plain letters', async ({ page }) => {
  await page.goto('/');
  const banner = page.locator('.neofetch svg.banner');
  test.skip((await banner.count()) === 0, 'the banner font draws none of the title');
  const name = (await banner.getAttribute('aria-label')) ?? '';
  expect(name).toBe(name.normalize('NFKC'));
  if (builtFromFixtures()) expect(name).toBe('Lil’Horse');
  await expect(page.getByRole('img', { name, exact: true })).toBeVisible();
});

test('the slogan types out once per session, in place', async ({ page }) => {
  await openHome(page);
  const card = page.locator('.neofetch');
  await expect(typing(page)).toBeVisible();
  const during = await card.boundingBox();
  await expect(typing(page)).toHaveCount(0);
  expect(await card.boundingBox()).toEqual(during);
  await expect(page.locator('.slogan-text')).toHaveCSS('opacity', '1');

  await page.reload();
  expect(await typingNow(page)).toEqual({ overlays: 0, hidden: false });
});

test('the slogan never types, and its cursor never blinks, under reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  expect(await typingNow(page)).toEqual({ overlays: 0, hidden: false });
  await expect(page.locator('.slogan > .cursor')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
