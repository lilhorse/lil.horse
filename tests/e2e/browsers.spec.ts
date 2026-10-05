import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pageContaining, pagePaths, searchableTitle, seekFailsafe } from './site';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function colours(page: Page) {
  return page.evaluate(() => {
    const pill = document.querySelector('.pill');
    const link = document.querySelector('.prose p a');
    return {
      pill: pill ? getComputedStyle(pill).backgroundColor : null,
      pillText: pill ? getComputedStyle(pill).color : null,
      highlighter: link ? getComputedStyle(link).backgroundImage : null,
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`tag and highlighter colours resolve in the ${colorScheme} theme`, async ({ page }) => {
    const tagged = pageContaining('class="pill');
    test.skip(!tagged, 'no tagged post in this build');
    await page.emulateMedia({ colorScheme });
    await page.goto(encodeURI(tagged ?? '/'));
    const tag = await colours(page);
    expect(tag.pill).not.toBe(TRANSPARENT);
    expect(tag.pill).toMatch(/^(rgb|color|oklab|lab)/);
    expect(tag.pillText).not.toBe(tag.pill);
    let highlighter: string | null = null;
    for (const path of pagePaths()) {
      await page.goto(encodeURI(path));
      highlighter = (await colours(page)).highlighter;
      if (highlighter !== null) break;
    }
    expect(highlighter, 'a page with a link in running text').toContain('linear-gradient');
  });
}

for (const [colorScheme, red] of [
  ['light', 'rgb(201, 42, 42)'],
  ['dark', 'rgb(247, 118, 142)'],
] as const) {
  test(`the stack's strike resolves to the ${colorScheme} theme's red`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => sessionStorage.setItem('intro-played', '1'));
    await page.goto('/');
    const item = page.locator('[data-stack] s').first();
    test.skip((await item.count()) === 0, 'the stack is not struck');
    expect(
      await item.evaluate((element) => getComputedStyle(element).getPropertyValue('--strike')),
    ).toBe(red);
  });
}

test('the intro failsafe shows the card in this engine', async ({ page }) => {
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto('/');
  const slogan = page.locator('.neofetch .slogan-text');
  test.skip((await slogan.count()) === 0, 'the root page has no slogan');
  expect((await seekFailsafe(page, 0)).length).toBeGreaterThan(0);
  await expect(slogan).toHaveCSS('opacity', '0');
  await seekFailsafe(page, 3000);
  await expect(slogan).toHaveCSS('opacity', '1');
});

test('the theme button and the palette work in this engine', async ({ page }) => {
  const title = await searchableTitle(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const before = (await colours(page)).body;
  await page.locator('[data-theme-toggle]').click();
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'dark');
  expect((await colours(page)).body).not.toBe(before);
  await page.keyboard.press('ControlOrMeta+k');
  const query = page.getByRole('combobox', { name: 'Search posts, pages and commands' });
  await expect(query).toBeFocused();
  await query.fill(title);
  const first = page.locator('[data-results] [role="option"]').first();
  await expect(first).toHaveAttribute('data-href', /^\//);
  expect(pagePaths()).toContain(decodeURI((await first.getAttribute('data-href')) ?? ''));
});
