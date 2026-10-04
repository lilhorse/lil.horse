import { expect, test } from '@playwright/test';
import { blockThirdParty } from './site';

test.beforeEach(({ page }) => blockThirdParty(page));

test('opts into cross-document view transitions unless motion is reduced', async ({ page }) => {
  await page.goto('/');
  const rule = () =>
    page.evaluate(() =>
      [...document.styleSheets].some((sheet) =>
        [...sheet.cssRules].some(
          (outer) =>
            outer instanceof CSSMediaRule &&
            outer.conditionText === '(prefers-reduced-motion: no-preference)' &&
            [...outer.cssRules].some(
              (inner) =>
                inner.constructor.name === 'CSSViewTransitionRule' &&
                (inner as { navigation?: string }).navigation === 'auto',
            ),
        ),
      ),
    );
  expect(await rule()).toBe(true);
  const names = await page.evaluate(() => ({
    header: getComputedStyle(document.querySelector('header') as Element).viewTransitionName,
    logos: [...document.querySelectorAll('.pixel-horse')]
      .filter((logo) => logo.checkVisibility())
      .map((logo) => getComputedStyle(logo).viewTransitionName),
  }));
  expect(names.header).toBe('site-header');
  expect(names.logos.filter((name) => name === 'site-logo')).toHaveLength(1);
});

test('keeps the open phone menu above positioned page content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phones only');
  await page.goto('/blog');
  await page.evaluate(() =>
    document
      .querySelector('main')
      ?.insertAdjacentHTML(
        'afterbegin',
        '<div style="position: relative; block-size: 100vh"></div>',
      ),
  );
  // With JavaScript the summary opens the command palette instead; the panel opens only without it.
  await page.locator('.site-menu').evaluate((menu) => menu.setAttribute('open', ''));
  const covered = await page.$$eval('.site-menu .panel a', (links) =>
    links
      .filter((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !link.contains(hit);
      })
      .map((link) => link.textContent?.trim()),
  );
  expect(covered).toEqual([]);
});

test('prerenders hovered same-origin pages at moderate eagerness', async ({ page }) => {
  await page.goto('/blog');
  const rules = await page.$eval('script[type="speculationrules"]', (script) =>
    JSON.parse(script.textContent ?? ''),
  );
  expect(rules.prerender[0].eagerness).toBe('moderate');
  expect(JSON.stringify(rules.prerender[0].where)).toContain('"/*"');
});
