import type { Page } from '@playwright/test';
import { CHAR_MS } from '../../src/scripts/slogan';
import { expect, test } from './fixtures';
import { builtFromFixtures } from './site';

const typing = (page: Page) => page.locator('.slogan-typed');

/** The parts of a layout-shift entry this file reads; TypeScript's DOM types lack them. */
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  sources: { node: Node | null }[];
}

/** Checked once, without retrying: typing that had started would still be running. */
const typingNow = (page: Page) =>
  page.evaluate(() => ({
    overlays: document.querySelectorAll('.slogan-typed').length,
    hidden: document.querySelector('.slogan')?.classList.contains('typing'),
  }));

async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  test.skip((await page.locator('[data-slogan]').count()) === 0, 'the root page has no slogan');
}

test('the banner is an image named by the title in plain letters', async ({ page }) => {
  await page.goto('/');
  const banner = page.locator('.neofetch svg.banner');
  test.skip((await banner.count()) === 0, 'the banner font draws none of the title');
  const name = (await banner.getAttribute('aria-label')) ?? '';
  expect(name).toBe(name.normalize('NFKC'));
  if (builtFromFixtures()) expect(name).toBe('Lil’Horse');
  await expect(page.getByRole('img', { name, exact: true })).toBeVisible();
});

test('the slogan types out once per session, in place', async ({ page }) => {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Object.assign(window, { sloganShifts: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        const slogan = document.querySelector('.slogan');
        if (entry.sources.some((source) => source.node && slogan?.contains(source.node)))
          shifts.push(entry.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // A paused clock fires the typing's timers only when the test moves it on.
  await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
  await openHome(page);
  const chars = Array.from((await page.locator('.slogan-text').textContent()) ?? '');
  const card = page.locator('.neofetch');
  const tick = async (count: number) => {
    for (let step = 0; step < count; step++) await page.clock.runFor(CHAR_MS);
  };

  await expect(typing(page)).toHaveText('▋');
  const before = await card.boundingBox();
  await tick(10);
  await expect(typing(page)).toHaveText(`${chars.slice(0, 10).join('')}▋`);
  expect(await card.boundingBox()).toEqual(before);
  await tick(chars.length - 10);
  await expect(typing(page)).toHaveCount(0);
  expect(await card.boundingBox()).toEqual(before);
  await expect(page.locator('.slogan-text')).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(() => (window as unknown as { sloganShifts: number[] }).sloganShifts),
  ).toEqual([]);

  await page.reload();
  expect(await typingNow(page)).toEqual({ overlays: 0, hidden: false });
});

test('the slogan never types, and its cursor never blinks, under reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  expect(await typingNow(page)).toEqual({ overlays: 0, hidden: false });
  await expect(page.locator('.slogan > .cursor')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
