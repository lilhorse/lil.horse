import { expect, test } from './fixtures';
import { builtFromFixtures, pagePaths, settle } from './site';

const firstPost = () => pagePaths().find((path) => /^\/blog\/[^/]+$/.test(path)) ?? '/blog';
const PAGES: [string, string][] = [
  ['home', '/'],
  ['blog', '/blog'],
  ['post', firstPost()],
];

test.skip(!builtFromFixtures(), 'baselines compare fixture builds only');

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const [name, path] of PAGES) {
      test(`${name} looks as it did`, async ({ page }, testInfo) => {
        test.skip(!['desktop', 'mobile'].includes(testInfo.project.name), 'Chromium only');
        await page.goto(encodeURI(path));
        await settle(page);
        // The footer's build hash changes with every commit.
        await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, {
          mask: [page.locator('.site-footer .build')],
        });
      });
    }
  });
}
