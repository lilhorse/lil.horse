import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pageContaining, pagePaths, settle } from './site';

const BACKGROUND = { light: 'rgb(242, 244, 247)', dark: 'rgb(26, 27, 38)' };
const TARGETS = 'a[href], button, summary';
const HOVER_LINKS = [
  ['/', '.posts .name a'],
  ['/blog', '.posts .name a'],
  ['/', '.neofetch dd a'],
  ['/', 'footer nav a'],
  ['/projects', '.card .name a'],
] as const;

/** Rendered controls under 44 x 44 px, leaving out links that flow inside prose text. */
function smallTargets(page: Page, selector: string): Promise<string[]> {
  return page.$$eval(selector, (elements) =>
    elements.flatMap((element) => {
      if (!element.checkVisibility()) return [];
      const box = element.getBoundingClientRect();
      if (box.width === 0 || element.classList.contains('skip-link')) return [];
      if (element.closest('.prose') && getComputedStyle(element).display === 'inline') return [];
      if (box.width >= 44 && box.height >= 44) return [];
      return [
        `${element.textContent?.trim().slice(0, 24)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      ];
    }),
  );
}

test('no page scrolls sideways', async ({ page }) => {
  for (const path of [...pagePaths(), '/no-such-page']) {
    await page.goto(encodeURI(path));
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect.soft(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('phone tap targets are at least 44 by 44 pixels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  for (const path of [...pagePaths(), '/no-such-page']) {
    await page.goto(encodeURI(path));
    await settle(page);
    expect.soft(await smallTargets(page, TARGETS), path).toEqual([]);
  }
});

test('a very long tag wraps instead of widening the page', async ({ page }) => {
  for (const path of pagePaths()) {
    await page.goto(encodeURI(path));
    const found = await page.evaluate(() => {
      const pill = document.querySelector('.pill');
      if (pill) pill.textContent = `#${'averylongtagname'.repeat(12)}`;
      return pill !== null;
    });
    if (!found) continue;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
    const titles = await page.$$eval('.posts .name', (names) =>
      names.map((name) => name.getBoundingClientRect().width),
    );
    for (const width of titles) expect(width, path).toBeGreaterThan(40);
  }
});

test('a toggle with a background colour keeps its text off the edge', async ({ page }) => {
  const path = pageContaining('class="prose"');
  test.skip(!path, 'no page has prose');
  await page.goto(encodeURI(path ?? '/'));
  const padding = await page.evaluate(() => {
    const prose = document.querySelector('.prose') as Element;
    prose.insertAdjacentHTML(
      'beforeend',
      '<details class="toggle hl-yellow"><summary>x</summary><p>y</p></details>',
    );
    return parseFloat(getComputedStyle(prose.lastElementChild as Element).paddingLeft);
  });
  expect(padding).toBeGreaterThan(0);
});

test('no footer line starts with a separator', async ({ page }) => {
  await page.goto('/');
  const offsets = await page.$$eval('.legal .sep', (separators) =>
    separators.map(
      (separator) =>
        separator.getBoundingClientRect().left -
        (separator.closest('p') as Element).getBoundingClientRect().left,
    ),
  );
  expect(offsets.length).toBeGreaterThan(0);
  for (const offset of offsets) expect(offset).toBeGreaterThan(1);
});

test('the neofetch contact row is no taller than its lines on phones', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/');
  const { height, lineHeight } = await page.$eval('.neofetch dd:has(a)', (dd) => ({
    height: dd.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(dd).lineHeight),
  }));
  const lines = Math.max(1, Math.round(height / lineHeight));
  expect(height).toBeCloseTo(lines * lineHeight, 0);
});

test('bold text inside a link keeps the link colour', async ({ page }) => {
  for (const path of pagePaths()) {
    await page.goto(encodeURI(path));
    const pairs = await page.$$eval('.prose a strong', (elements) =>
      elements.map((element) => [
        getComputedStyle(element).color,
        getComputedStyle(element.closest('a') as Element).color,
      ]),
    );
    for (const [bold, link] of pairs) expect(bold, path).toBe(link);
  }
});

test('data-theme overrides the system colour scheme', async ({ page }) => {
  const visibleLogos = (theme: string) =>
    page.evaluate(
      (name) =>
        [...document.querySelectorAll(`.theme-${name} svg`)].filter(
          (svg) => svg.getBoundingClientRect().width > 0,
        ).length,
      theme,
    );
  for (const [system, forced] of [
    ['dark', 'light'],
    ['light', 'dark'],
  ] as const) {
    await page.emulateMedia({ colorScheme: system });
    await page.goto('/');
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await background()).toBe(BACKGROUND[system]);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, forced);
    expect(await background()).toBe(BACKGROUND[forced]);
    expect(await visibleLogos(forced)).toBeGreaterThan(0);
    expect(await visibleLogos(system)).toBe(0);
  }
});

test('code blocks follow data-theme too', async ({ page }) => {
  const path = pageContaining('class="expressive-code"');
  test.skip(!path, 'no page has a code block');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(encodeURI(path ?? '/'));
  const code = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.expressive-code pre') as Element).backgroundColor,
    );
  expect(await code()).toBe('rgb(22, 22, 30)');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  expect(await code()).toBe('rgb(234, 237, 242)');
});

test('the glint stops when the visitor asks for less motion', async ({ page }) => {
  const glint = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.animated .horse-glint') as Element).animationName,
    );
  await page.goto('/');
  expect(await glint()).toBe('horse-glint');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await glint()).toBe('none');
});

test('list and social links are underlined only while the mouse is over them', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs a mouse');
  for (const [path, selector] of HOVER_LINKS) {
    await page.goto(path);
    const link = page.locator(selector).first();
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    await link.hover();
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await page.mouse.move(0, 0);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
  }
});

test('the skip link appears on focus and jumps to the content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('the phone menu button opens the command palette from the keyboard', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/blog');
  const menu = page.locator('.site-menu');
  await menu.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog[data-palette]')).toHaveAttribute('open', '');
  await expect(menu).not.toHaveAttribute('open', '');
});

test('the 404 page names the missing path, decoded', async ({ page }) => {
  for (const [path, shown] of [
    ['/does/not/exist', '/does/not/exist'],
    ['/%E8%B1%86%E7%93%A3-x', '/豆瓣-x'],
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.locator('.error')).toHaveText(`zsh: command not found: ${shown}`);
  }
});
