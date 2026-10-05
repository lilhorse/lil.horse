import type { Page } from '@playwright/test';
import { CHAR_MS, INTRO_KEY, STRIKE_GAP_MS, STRIKE_MS } from '../../src/scripts/intro';
import { expect, test } from './fixtures';
import { builtFromFixtures, seekFailsafe } from './site';

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

const shimmer = (page: Page) =>
  page
    .locator('.neofetch .banner .shine')
    .evaluate((element) => getComputedStyle(element).animationName);

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
  expect(
    await page.evaluate(() => document.documentElement.hasAttribute('data-intro-pending')),
  ).toBe(false);
  expect(await shimmer(page)).toBe('none');
  const before = await card.boundingBox();
  await run(CHAR_MS, slogan.length);
  await expect(page.locator('.slogan .typed.parked')).toHaveText(`${slogan.join('')}▋`);
  await expect(page.locator('[data-stack] s[data-drawn]')).toHaveCount(Math.min(items, 1));
  await run(STRIKE_GAP_MS, items - 1);
  await expect(page.locator('[data-stack] s[data-drawn]')).toHaveCount(items);
  await expect(page.locator('[data-stack] s').last()).toHaveCSS('background-size', '100% 2px');
  expect(await card.boundingBox()).toEqual(before);
  await run(STRIKE_MS);
  await expect(page.locator('.slogan .typed')).toHaveCount(0);
  await expect(page.locator('.comment .typed')).toHaveText('▋');
  await run(CHAR_MS, 10);
  await expect(page.locator('.comment .typed')).toHaveText(`${note.slice(0, 10).join('')}▋`);
  expect(await shimmer(page)).toBe('none');
  await run(CHAR_MS, note.length - 10);
  await expect(page.locator('.typed')).toHaveCount(0);
  expect(await shimmer(page)).toBe('shine');
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

test('the intro never plays, and nothing blinks or shimmers, under reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  expect(await playingNow(page)).toEqual({ overlays: 0, playing: false });
  await expect(page.locator('.neofetch .cursor')).toHaveCSS('animation-name', 'none');
  expect(await shimmer(page)).toBe('none');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('hides what the intro will type until it starts, and shows it after 3 s if it never does', async ({
  page,
}) => {
  await page.route('**/_astro/*.js', (route) => route.abort());
  await openHome(page);
  test.skip((await page.locator('[data-stack] s').count()) === 0, 'the stack is not struck');
  const parts = () =>
    page.evaluate(() => {
      const style = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element) : null;
      };
      return {
        pending: document.documentElement.hasAttribute('data-intro-pending'),
        slogan: style('.slogan-text')?.opacity,
        note: style('.note-text')?.opacity,
        cursor: style('.comment > .cursor')?.opacity,
        strike: style('[data-stack] s')?.backgroundSize,
      };
    });

  expect(new Set(await seekFailsafe(page, 0))).toEqual(new Set([3000]));
  expect(await parts()).toEqual({
    pending: true,
    slogan: '0',
    note: '0',
    cursor: '0',
    strike: '0px 2px',
  });
  await seekFailsafe(page, 3000);
  expect(await parts()).toEqual({
    pending: true,
    slogan: '1',
    note: '1',
    cursor: '1',
    strike: '100% 2px',
  });
  const shine = page.locator('.neofetch .banner .shine');
  if ((await shine.count()) > 0) await expect(shine).toHaveCSS('animation-delay', '3s');
});

test('does not play the intro over a card that the failsafe has already shown', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_astro/*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await page.locator('.neofetch dl').waitFor({ state: 'attached' });
  test.skip((await page.locator('[data-slogan]').count()) === 0, 'the root page has no slogan');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .some(
        (animation) => 'animationName' in animation && animation.animationName === 'intro-failsafe',
      ),
  );
  await page.evaluate(() => {
    for (const animation of document.getAnimations())
      if ('animationName' in animation && animation.animationName === 'intro-failsafe')
        animation.finish();
  });
  await expect(page.locator('.slogan-text')).toHaveCSS('opacity', '1');

  release();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-intro-pending')))
    .toBe(false);
  expect(await playingNow(page)).toEqual({ overlays: 0, playing: false });
  await expect(page.locator('.slogan-text')).toHaveCSS('opacity', '1');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTRO_KEY)).toBeNull();
});

test('the banner shimmers at once when the intro has already played', async ({ page }) => {
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), INTRO_KEY);
  await page.goto('/');
  test.skip((await page.locator('.neofetch .banner .shine').count()) === 0, 'no banner');
  expect(await shimmer(page)).toBe('shine');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the stack's strike is a bold line in the ${colorScheme} theme's red`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript((key) => sessionStorage.setItem(key, '1'), INTRO_KEY);
    await page.goto('/');
    const item = page.locator('[data-stack] s').first();
    test.skip((await item.count()) === 0, 'the stack is not struck');
    const strike = await item.evaluate((element) => {
      const style = getComputedStyle(element);
      return { colour: style.getPropertyValue('--strike'), size: style.backgroundSize };
    });
    expect(strike).toEqual({
      colour: colorScheme === 'light' ? 'rgb(201, 42, 42)' : 'rgb(247, 118, 142)',
      size: '100% 2px',
    });
  });
}

test('a space parts the last stack item from the note on a shared line', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'a phone never fits the note beside an item');
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), INTRO_KEY);
  await page.goto('/');
  test.skip((await page.locator('[data-note]').count()) === 0, 'the card has no stack note');
  test.skip((await page.locator('[data-stack] s').count()) === 0, 'the stack is not struck');
  const { gap, sameLine } = await page.locator('[data-stack]').evaluate((stack) => {
    const nodes = [...stack.childNodes];
    const last = nodes.findLastIndex((node) => node instanceof Element && node.matches('s'));
    for (const node of nodes.slice(0, last)) node.remove();
    const box = (text: Node | null | undefined, from: number, to: number) => {
      const range = document.createRange();
      if (text) {
        range.setStart(text, from);
        range.setEnd(text, to);
      }
      return range.getBoundingClientRect();
    };
    const item = stack.querySelector('s')?.firstChild;
    const note = stack.querySelector('.note-text')?.firstChild;
    const start = note?.textContent?.search(/\S/) ?? 0;
    const before = box(item, 0, item?.textContent?.length ?? 0);
    const after = box(note, start, start + 1);
    return { gap: after.left - before.right, sameLine: Math.abs(after.top - before.top) < 1 };
  });
  expect(sameLine).toBe(true);
  expect(gap).toBeGreaterThan(4);
});

test('keeps the strike as a native line-through in forced colours and in print', async ({
  page,
}) => {
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), INTRO_KEY);
  await page.goto('/');
  const item = page.locator('[data-stack] s').first();
  test.skip((await item.count()) === 0, 'the stack is not struck');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(item).toHaveCSS('text-decoration-line', 'line-through');
  await expect(item).toHaveCSS('background-image', 'none');
  await page.emulateMedia({ forcedColors: 'none', media: 'print', colorScheme: 'light' });
  await expect(item).toHaveCSS('text-decoration-line', 'line-through');
  await expect(item).toHaveCSS('text-decoration-color', 'rgb(201, 42, 42)');
  await expect(item).toHaveCSS('background-image', 'none');
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
