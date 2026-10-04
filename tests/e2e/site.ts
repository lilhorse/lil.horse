import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { FIXTURE_MARKER } from '../../integrations/static-assets';

const DIST = 'dist';

function htmlFiles(): string[] {
  if (!existsSync(DIST))
    throw new Error('dist/ is missing: run pnpm build or pnpm build:fixtures first');
  return readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.html') && !file.startsWith(`katex${sep}`))
    .map((file) => join(DIST, file));
}

function routeOf(file: string): string {
  const route = `/${relative(DIST, file)
    .split(sep)
    .join('/')
    .replace(/\.html$/, '')}`;
  return route === '/index' ? '/' : route;
}

/** Every built page except 404.html, as the path a visitor requests. */
export function pagePaths(): string[] {
  return htmlFiles()
    .filter((file) => file !== join(DIST, '404.html'))
    .map(routeOf)
    .sort();
}

/** The first built page whose HTML contains the given text, or null. */
export function pageContaining(text: string): string | null {
  const file = htmlFiles().find((path) => readFileSync(path, 'utf8').includes(text));
  return file ? routeOf(file) : null;
}

/** Whether dist/ was built from the recorded fixtures rather than from Notion. */
export function builtFromFixtures(): boolean {
  return existsSync(join(DIST, FIXTURE_MARKER));
}

/** Waits for web fonts and for Expressive Code to make overflowing code blocks focusable. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>('.expressive-code pre')].every(
      (pre) => pre.scrollWidth <= pre.clientWidth || pre.tabIndex === 0,
    ),
  );
}
