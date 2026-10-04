import { beforeEach, describe, expect, it, vi } from 'vitest';

const loading = vi.hoisted(() => ({ attempts: 0, fail: true, opened: 0 }));

vi.mock('../../src/scripts/palette', () => {
  loading.attempts += 1;
  if (loading.fail) throw new Error('Failed to fetch dynamically imported module');
  return {
    setupPalette: () => ({
      open: () => {
        loading.opened += 1;
      },
      close: () => undefined,
    }),
  };
});

const MARKUP = `<details class="site-menu"><summary>menu</summary><a href="/blog">blog</a></details>
<button type="button" data-palette-open>search <kbd>⌘K</kbd></button>
<dialog data-palette></dialog>`;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const menu = () => document.querySelector('details') as HTMLDetailsElement;
const tapMenu = () => (document.querySelector('summary') as HTMLElement).click();

beforeEach(async () => {
  Object.assign(loading, { attempts: 0, fail: true, opened: 0 });
  document.body.innerHTML = MARKUP;
  vi.resetModules();
  await import('../../src/scripts/entry');
});

// Every imported copy of the entry script listens on document, so only the first test sends keys.
describe('when the palette cannot load', () => {
  it('stays quiet for the search button and the shortcut, and tries again each time', async () => {
    (document.querySelector('[data-palette-open]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(loading.attempts).toBe(1));
    await settle();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(loading.attempts).toBe(2));
    await settle();
    expect(loading.opened).toBe(0);
  });

  it('opens the plain menu instead, closes it at once, and tries the palette again', async () => {
    tapMenu();
    await vi.waitFor(() => expect(menu().open).toBe(true));
    expect(loading.attempts).toBe(1);
    tapMenu();
    expect(menu().open).toBe(false);
    await settle();
    expect(loading.attempts).toBe(1);
    loading.fail = false;
    tapMenu();
    await vi.waitFor(() => expect(loading.opened).toBe(1));
    expect(loading.attempts).toBe(2);
    expect(menu().open).toBe(false);
  });
});
