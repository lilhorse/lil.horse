import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pageContaining } from './site';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const help = (page: Page) => page.locator('dialog[data-help]');
const palette = (page: Page) => page.locator('dialog[data-palette]');
const toggle = (page: Page) => help(page).locator('[data-shortcuts-toggle]');

test('g then a letter navigates within a second', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForURL(/\/blog$/);
  await page.keyboard.press('g');
  await page.waitForTimeout(1100);
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\/blog$/);
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/projects$/);
});

test('[ and ] walk between posts', async ({ page }) => {
  const start = pageContaining('rel="prev"') ?? '';
  test.skip(!start, 'no page links to an older neighbour');
  await page.goto(encodeURI(start));
  const here = page.url();
  const older = await page
    .locator('a[rel~="prev"]')
    .first()
    .evaluate((link) => (link as HTMLAnchorElement).href);
  await page.keyboard.press('[');
  await page.waitForURL(older);
  await page.keyboard.press(']');
  await expect(page).toHaveURL(here);
});

test('t switches the theme and ? opens the help, accessible in both themes', async ({ page }) => {
  await page.goto('/');
  for (const pref of ['light', 'dark']) {
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', pref);
    await page.keyboard.press('Shift+?');
    await expect(help(page)).toHaveAttribute('open', '');
    await expect(help(page).getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      violations.map(({ id }) => id),
      pref,
    ).toEqual([]);
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme-pref', pref);
    await page.keyboard.press('Escape');
    await expect(help(page)).not.toHaveAttribute('open', '');
    await expect(help(page).locator(':focus')).toHaveCount(0);
  }
});

test('the switch turns single keys off but keeps the palette shortcut', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Shift+?');
  await help(page).getByRole('checkbox', { name: 'Single-key shortcuts' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(help(page)).not.toHaveAttribute('open', '');
  await expect(toggle(page)).not.toBeFocused();
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toHaveAttribute('open', '');
  await page.reload();
  await page.keyboard.press('Shift+?');
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  await expect(help(page)).not.toHaveAttribute('open', '');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');
  await page.keyboard.press('ControlOrMeta+k');
  await palette(page).locator('#palette-help').click();
  await expect(help(page)).toHaveAttribute('open', '');
  await expect(toggle(page)).not.toBeChecked();
});

test('typing in the palette never triggers single-key shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toHaveAttribute('open', '');
  await expect(page.locator('#palette-query')).toBeFocused();
  await page.keyboard.type('gbt?');
  await expect(page.locator('#palette-query')).toHaveValue('gbt?');
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');
  await expect(help(page)).not.toHaveAttribute('open', '');
});
