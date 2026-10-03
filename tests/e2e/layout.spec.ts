import { expect, test, type Page } from '@playwright/test';
import { pageContaining, pagePaths, settle } from './site';

const BACKGROUND = { light: 'rgb(242, 244, 247)', dark: 'rgb(26, 27, 38)' };
const TARGETS = 'header a[href], header summary, footer a[href]';

/** Controls under 44 x 44 px, leaving out links that flow inside prose text. */
function smallTargets(page: Page, selector: string): Promise<string[]> {
  return page.$$eval(selector, (elements) =>
    elements.flatMap((element) => {
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
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('phone tap targets are at least 44 by 44 pixels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  for (const path of [...pagePaths(), '/no-such-page']) {
    await page.goto(encodeURI(path));
    await settle(page);
    expect(await smallTargets(page, TARGETS), path).toEqual([]);
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

test('post links are underlined only while the mouse is over them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs a mouse');
  for (const path of ['/', '/blog']) {
    await page.goto(path);
    const link = page.locator('.posts .name a').first();
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

test('the phone menu opens from the keyboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/blog');
  const menu = page.locator('.site-menu');
  await menu.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.getByRole('link', { name: 'contact' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'blog' })).toHaveAttribute('aria-current', 'page');
});
