import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const typing = (page: Page) => page.locator('.slogan-typed');

/** Checked once, without retrying: typing that had started would still be running. */
const typingNow = (page: Page) =>
  page.evaluate(() => ({
    overlays: document.querySelectorAll('.slogan-typed').length,
    hidden: document.querySelector('.slogan')?.classList.contains('typing'),
  }));

test('the banner is an image named by the title in plain letters', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Lil’Horse' })).toBeVisible();
});

test('the slogan types out once per session, in place', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
  expect(await typingNow(page)).toEqual({ overlays: 0, hidden: false });
  await expect(page.locator('.slogan > .cursor')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
