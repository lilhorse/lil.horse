import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { pagePaths, settle } from './site';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// No recorded post has three headings, so the three-column layout is built in the browser from the real CSS.
test('the three-column outline neither overflows nor breaks accessibility', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the outline shows from 1200 px');
  const post = pagePaths().find((path) => /^\/blog\/[^/]+$/.test(path));
  test.skip(!post, 'no post in this build');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(encodeURI(post ?? '/'));
    await settle(page);
    const placed = await page.evaluate(() => {
      const doc = document.querySelector('.doc');
      const article = document.querySelector('.doc-main');
      if (!doc || !article) return null;
      const scope = doc.getAttributeNames().find((name) => name.startsWith('data-astro-cid-'));
      doc.classList.add('has-toc');
      const column = document.createElement('div');
      column.className = 'doc-toc';
      if (scope) column.setAttribute(scope, '');
      column.innerHTML =
        '<nav class="toc" aria-label="On this page"><ul>' +
        ['Intro', 'A much longer heading that has to wrap inside the column', 'Closing']
          .map((text, index) => `<li><a href="#h${index}">${text}</a></li>`)
          .join('') +
        '</ul></nav>';
      article.after(column);
      return {
        left: column.getBoundingClientRect().left,
        articleRight: article.getBoundingClientRect().right,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(placed, colorScheme).not.toBeNull();
    expect(placed?.left ?? 0, colorScheme).toBeGreaterThan(placed?.articleRight ?? 0);
    expect(placed?.overflow, colorScheme).toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      violations.map(({ id }) => id),
      colorScheme,
    ).toEqual([]);
  }
});
