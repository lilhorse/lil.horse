import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/** Playwright's test, with giscus.app and the Cloudflare beacon stubbed as empty scripts for every test. */
export const test = base.extend<{ blockThirdParty: undefined }>({
  blockThirdParty: [
    async ({ page }, use) => {
      for (const origin of ['https://giscus.app', 'https://static.cloudflareinsights.com'])
        await page.route(`${origin}/**`, (route) =>
          route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
        );
      await use(undefined);
    },
    { auto: true },
  ],
});
