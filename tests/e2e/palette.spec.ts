import AxeBuilder from '@axe-core/playwright';
import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { builtFromFixtures, searchableTitle } from './site';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const dialog = (page: Page) => page.locator('dialog[data-palette]');
const query = (page: Page) =>
  page.getByRole('combobox', { name: 'Search posts, pages and commands' });
const results = (page: Page) => dialog(page).locator('[data-results] [role="option"]');
const UNAVAILABLE = 'Search is not available on this page.';

async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return violations.map(({ id }) => id);
}

async function open(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog(page)).toHaveAttribute('open', '');
  await expect(query(page)).toBeFocused();
}

test('opens with the shortcuts and the header button, and closes with Escape', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  for (const shortcut of ['Meta+k', 'Control+k', '/']) {
    await page.keyboard.press(shortcut);
    await expect(dialog(page), shortcut).toHaveAttribute('open', '');
    await expect(query(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open', '');
    await expect(page.locator('#palette-query')).not.toBeFocused();
  }
  if (testInfo.project.name === 'desktop') {
    const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    await page.getByRole('button', { name: mac ? 'search ⌘K' : 'search Ctrl K' }).click();
  } else {
    await page.locator('.site-menu summary').click();
    await expect(page.locator('.site-menu')).not.toHaveAttribute('open', '');
  }
  await expect(dialog(page)).toHaveAttribute('open', '');
});

test.describe('search', () => {
  test.describe('recall', () => {
    test.skip(!builtFromFixtures(), 'the queries name what the recorded fixtures contain');
    for (const [text, href] of [
      ['Schindler', '/blog/douban'],
      ['辛德勒', '/blog/douban'],
      ['餐馆', '/blog/douban'],
      ['当哈利遇到莎莉', '/blog/douban'],
      ['programming', '/blog/helloworld'],
    ]) {
      test(`finds ${text}`, async ({ page }) => {
        await page.goto('/');
        await open(page);
        await query(page).fill(text);
        await expect(results(page).first()).toHaveAttribute('data-href', href);
        await expect(results(page).first().locator('mark').first()).toBeVisible();
      });
    }
  });

  test('leaves the navigation and footer out of the index', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await query(page).fill('neofetch');
    await expect
      .poll(
        async () =>
          (await results(page).count()) > 0 ||
          (await dialog(page).getByRole('status').textContent()) === 'No results',
      )
      .toBe(true);
    // Fuzzy matches elsewhere are fine; the home page itself must never be a result.
    expect(
      await results(page).evaluateAll((els) => els.map((el) => el.dataset.href)),
    ).not.toContain('/');
    // A real post may mention neofetch; the recorded fixtures never do.
    if (builtFromFixtures())
      for (const text of await results(page).allTextContents())
        expect(text.toLowerCase()).not.toContain('neofetch');
  });

  test('opens the first result with Enter', async ({ page }) => {
    const title = await searchableTitle(page);
    await page.goto('/');
    await open(page);
    await query(page).fill(title);
    const first = results(page).first();
    await expect(first).toBeVisible();
    // A command that also matches the title keeps the selection; the arrows wrap round to the results.
    for (let step = 0; (await first.getAttribute('aria-selected')) !== 'true'; step += 1) {
      expect(step, 'arrow presses').toBeLessThan(20);
      await page.keyboard.press('ArrowDown');
    }
    await expect(first).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const href = new URL((await first.getAttribute('data-href')) ?? '', page.url()).href;
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(href);
  });
});

test('filters the commands and runs the chosen one from the keyboard', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await query(page).fill('proj');
  const option = dialog(page).locator('#palette-nav-projects');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(dialog(page).locator('#palette-nav-home')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
});

test('switches the theme from the palette', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await query(page).fill('theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'light');
  await expect(dialog(page).locator('[data-theme-hint]')).toHaveText('light → dark');
});

test('copies the address built at runtime, which the HTML never spells out', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are a Chromium feature');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const html = await page.content();
  await open(page);
  await query(page).fill('copy');
  await page.keyboard.press('Enter');
  await expect(dialog(page).locator('#palette-copy-email .label')).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  expect(html).not.toContain(copied);
});

test('is accessible while open, in both themes', async ({ page }) => {
  const title = await searchableTitle(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/blog');
    await open(page);
    await query(page).fill(title);
    await expect(results(page).first()).toBeVisible();
    expect(await violations(page), `${colorScheme}, results`).toEqual([]);
    await query(page).fill('zzzqqq');
    await expect(dialog(page).getByText('No results')).toBeVisible();
    expect(await violations(page), `${colorScheme}, no results`).toEqual([]);
    await expect(dialog(page).getByRole('status')).toHaveText('No results');
  }
});

test('says when search is not available, accessibly, in both themes', async ({ page }) => {
  await page.route('**/pagefind/pagefind.js', (route) => route.abort());
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/blog');
    await open(page);
    await query(page).fill('hello');
    await expect(dialog(page).getByText(UNAVAILABLE)).toBeVisible();
    expect(await violations(page), colorScheme).toEqual([]);
    await expect(dialog(page).getByRole('status')).toHaveText(UNAVAILABLE);
  }
});

test('announces the phone menu button as opening a dialog', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/blog');
  await expect(page.locator('.site-menu summary')).toHaveAttribute('aria-haspopup', 'dialog');
  // Chromium's own accessibility tree, which can differ from the role Playwright computes.
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const button = nodes.find(
    (node) => node.name?.value === 'menu' && node.role?.value !== 'StaticText',
  );
  expect(button?.role?.value).toBe('button');
  expect(button?.properties?.find(({ name }) => name === 'hasPopup')?.value.value).toBe('dialog');
});

test('offers the theme segments and 44 px options on phones', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/blog');
  await page.locator('.site-menu summary').click();
  await expect(dialog(page)).toHaveAttribute('open', '');
  await dialog(page).getByRole('button', { name: 'dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'dark');
  const heights = await dialog(page)
    .locator('[role="option"]:visible')
    .evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('keeps the plain menu working without JavaScript', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  const context = await browser.newContext({ ...devices['Pixel 7'], javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/blog');
  await page.locator('.site-menu summary').click();
  await expect(page.locator('.site-menu')).toHaveAttribute('open', '');
  await expect(page.locator('.site-menu').getByRole('link', { name: 'contact' })).toBeVisible();
  await context.close();
});

test('falls back to the plain menu when the palette cannot load', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.route('**/_astro/palette.*.js', (route) => route.abort());
  await page.goto('/blog');
  const menu = page.locator('.site-menu');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await menu.locator('summary').click();
    await expect(menu).toHaveAttribute('open', '');
    await expect(menu.getByRole('link', { name: 'contact' })).toBeVisible();
    await menu.locator('summary').click();
    await expect(menu).not.toHaveAttribute('open', '');
  }
  await expect(dialog(page)).not.toHaveAttribute('open', '');
});
