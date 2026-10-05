import type { Page } from '@playwright/test';
import { CHAR_MS, INTRO_KEY, STRIKE_GAP_MS, STRIKE_MS } from '../../src/scripts/intro';
import { expect, test } from './fixtures';
import { builtFromFixtures } from './site';

/** The parts of a layout-shift entry this file reads; TypeScript's DOM types lack them. */
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  sources: { node: Node | null }[];
}

/** Checked once, without retrying: an intro that had started would still be playing. */
const playingNow = (page: Page) =>
  page.evaluate(() => ({
    overlays: document.querySelectorAll('.typed').length,
    playing: document.querySelector('[data-intro]')?.classList.contains('intro'),
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

test('the intro plays once per session, in place, and ends as the page began', async ({ page }) => {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Object.assign(window, { cardShifts: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        const card = document.querySelector('.neofetch');
        if (entry.sources.some((source) => source.node && card?.contains(source.node)))
          shifts.push(entry.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // A paused clock fires the intro's timers only when the test moves it on.
  await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
  await openHome(page);
  const note = Array.from((await page.locator('.note-text').textContent()) ?? '');
  test.skip(note.length === 0, 'the card has no stack note');
  const slogan = Array.from((await page.locator('.slogan-text').textContent()) ?? '');
  const items = await page.locator('[data-stack] s').count();
  const card = page.locator('.neofetch');
  const run = async (ms: number, times = 1) => {
    for (let step = 0; step < times; step++) await page.clock.runFor(ms);
  };

  await expect(page.locator('.slogan .typed')).toHaveText('▋');
  const before = await card.boundingBox();
  await run(CHAR_MS, slogan.length);
  await expect(page.locator('.slogan .typed.parked')).toHaveText(`${slogan.join('')}▋`);
  await expect(page.locator('[data-stack] s[data-drawn]')).toHaveCount(Math.min(items, 1));
  await run(STRIKE_GAP_MS, items - 1);
  await expect(page.locator('[data-stack] s[data-drawn]')).toHaveCount(items);
  expect(await card.boundingBox()).toEqual(before);
  await run(STRIKE_MS);
  await expect(page.locator('.slogan .typed')).toHaveCount(0);
  await expect(page.locator('.comment .typed')).toHaveText('▋');
  await run(CHAR_MS, 10);
  await expect(page.locator('.comment .typed')).toHaveText(`${note.slice(0, 10).join('')}▋`);
  await run(CHAR_MS, note.length - 10);
  await expect(page.locator('.typed')).toHaveCount(0);
  expect(await card.boundingBox()).toEqual(before);
  await expect(page.locator('.note-text')).toHaveCSS('opacity', '1');
  await expect(page.locator('.comment > .cursor')).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(() => (window as unknown as { cardShifts: number[] }).cardShifts),
  ).toEqual([]);

  const played = await card.evaluate((element) => element.outerHTML);
  await page.reload();
  expect(await playingNow(page)).toEqual({ overlays: 0, playing: false });
  expect(await card.evaluate((element) => element.outerHTML)).toBe(played);
});

test('the intro never plays, and the cursor never blinks, under reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  expect(await playingNow(page)).toEqual({ overlays: 0, playing: false });
  await expect(page.locator('.neofetch .cursor')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('hovering a stack item lifts its strike', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs a pointer that hovers');
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), INTRO_KEY);
  await page.goto('/');
  const item = page.locator('[data-stack] s').first();
  test.skip((await item.count()) === 0, 'the stack is not struck');
  const strike = () =>
    item.evaluate((element) => getComputedStyle(element).getPropertyValue('--strike'));
  const transparent = 'rgba(0, 0, 0, 0)';
  expect(await strike()).not.toBe(transparent);
  await item.hover();
  await expect.poll(strike).toBe(transparent);
  const text = await page
    .locator('[data-stack]')
    .evaluate((element) => getComputedStyle(element).color);
  await expect(item).toHaveCSS('color', text);
  await page.mouse.move(0, 0);
  await expect.poll(strike).not.toBe(transparent);
});
