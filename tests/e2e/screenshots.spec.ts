import { test } from '@playwright/test';
import { pagePaths, settle } from './site';

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture screenshots for review');

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} screenshots`, () => {
    test.use({ colorScheme });

    for (const path of [...pagePaths(), '/no-such-page']) {
      test(`capture ${path}`, async ({ page }, testInfo) => {
        await page.goto(encodeURI(path));
        await page.$$eval('img[loading="lazy"]', (images) => {
          for (const image of images) (image as HTMLImageElement).loading = 'eager';
        });
        await page.waitForLoadState('networkidle');
        await settle(page);
        const name = path === '/' ? 'home' : path.slice(1).replaceAll('/', '_');
        await page.screenshot({
          path: `test-results/screenshots/${testInfo.project.name}-${colorScheme}-${name}.png`,
          fullPage: true,
        });
      });
    }
  });
}
