import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaletteDeps } from '../../src/scripts/palette';

const loading = { attempts: 0, fail: true, opened: 0, deps: null as PaletteDeps | null };
const helpLoading = { attempts: 0, fail: true, opened: 0 };

function paletteModule() {
  loading.attempts += 1;
  if (loading.fail) throw new Error('Failed to fetch dynamically imported module');
  return {
    setupPalette: (_dialog: HTMLDialogElement, deps: PaletteDeps) => {
      loading.deps = deps;
      return {
        open: () => {
          loading.opened += 1;
        },
        close: () => undefined,
      };
    },
  };
}

function helpModule() {
  helpLoading.attempts += 1;
  if (helpLoading.fail) throw new Error('Failed to fetch dynamically imported module');
  return {
    setupHelp: () => ({
      open: () => {
        helpLoading.opened += 1;
      },
    }),
  };
}

const MARKUP = `<details class="site-menu"><summary>menu</summary><a href="/blog">blog</a></details>
<button type="button" data-palette-open>search <kbd>⌘K</kbd></button>
<dialog data-palette></dialog>
<dialog data-help></dialog>`;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const menu = () => document.querySelector('details') as HTMLDetailsElement;
const tapMenu = () => (document.querySelector('summary') as HTMLElement).click();
const clickSearch = () =>
  (document.querySelector('[data-palette-open]') as HTMLButtonElement).click();
let reloads = 0;

beforeEach(async () => {
  Object.assign(loading, { attempts: 0, fail: true, opened: 0, deps: null });
  Object.assign(helpLoading, { attempts: 0, fail: true, opened: 0 });
  reloads = 0;
  vi.spyOn(location, 'reload').mockImplementation(() => {
    reloads += 1;
  });
  document.body.innerHTML = MARKUP;
  vi.resetModules();
  // Registered per test: vi.mock would keep a module that loaded once, so it could never fail again.
  vi.doMock('../../src/scripts/palette', paletteModule);
  vi.doMock('../../src/scripts/help', helpModule);
  await import('../../src/scripts/entry');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Every imported copy of the entry script listens on document, so only the first test sends keys.
describe('when the palette cannot load', () => {
  it('stays quiet once, then reloads the page, whose new HTML names the new chunks', async () => {
    clickSearch();
    await vi.waitFor(() => expect(loading.attempts).toBe(1));
    await settle();
    expect(reloads).toBe(0);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(loading.attempts).toBe(2));
    await vi.waitFor(() => expect(reloads).toBe(1));
    expect(loading.opened).toBe(0);
  });

  it('never reloads while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    for (const attempt of [1, 2, 3]) {
      clickSearch();
      await vi.waitFor(() => expect(loading.attempts).toBe(attempt));
      await settle();
    }
    expect(reloads).toBe(0);
  });

  it('keeps the plain menu as the phone fallback, without reloading', async () => {
    tapMenu();
    await vi.waitFor(() => expect(menu().open).toBe(true));
    tapMenu();
    tapMenu();
    await vi.waitFor(() => expect(loading.attempts).toBe(2));
    await vi.waitFor(() => expect(menu().open).toBe(true));
    expect(reloads).toBe(0);
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

describe('when the help cannot load', () => {
  it('tries again the next time the palette asks for it', async () => {
    loading.fail = false;
    clickSearch();
    await vi.waitFor(() => expect(loading.opened).toBe(1));
    loading.deps?.openHelp?.();
    await vi.waitFor(() => expect(helpLoading.attempts).toBe(1));
    await settle();
    helpLoading.fail = false;
    loading.deps?.openHelp?.();
    await vi.waitFor(() => expect(helpLoading.opened).toBe(1));
    expect(helpLoading.attempts).toBe(2);
    expect(reloads).toBe(0);
  });

  it('reloads the page when it fails a second time', async () => {
    loading.fail = false;
    clickSearch();
    await vi.waitFor(() => expect(loading.opened).toBe(1));
    loading.deps?.openHelp?.();
    await vi.waitFor(() => expect(helpLoading.attempts).toBe(1));
    await settle();
    expect(reloads).toBe(0);
    loading.deps?.openHelp?.();
    await vi.waitFor(() => expect(reloads).toBe(1));
  });
});

describe('the phone menu', () => {
  it('announces its button as opening a dialog once the script takes it over', () => {
    const summary = document.querySelector('summary') as HTMLElement;
    expect(summary.getAttribute('role')).toBe('button');
    expect(summary.getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('copying the address', () => {
  it('rejects instead of throwing when the browser has no clipboard', async () => {
    loading.fail = false;
    clickSearch();
    await vi.waitFor(() => expect(loading.opened).toBe(1));
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as never);
    let copying: Promise<void> | undefined;
    expect(() => {
      copying = loading.deps?.copy('sup@lil.horse');
    }).not.toThrow();
    await expect(copying).rejects.toBeInstanceOf(TypeError);
  });
});
