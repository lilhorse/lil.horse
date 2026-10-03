import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  initTheme,
  nextPref,
  readPref,
  resolveTheme,
  type ThemePref,
} from '../../src/scripts/theme';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function media(matches: boolean) {
  const listeners: (() => void)[] = [];
  return {
    matches,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.push(listener);
    },
    change(next: boolean) {
      this.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

const metas = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );
const state = () => ({
  theme: document.documentElement.dataset.theme,
  pref: document.documentElement.dataset.themePref,
});

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#e6e9ef" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#16161e" media="(prefers-color-scheme: dark)">';
  document.body.innerHTML = '<button data-theme-toggle>theme</button>';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePref;
});

describe('theme helpers', () => {
  it('resolves system to the OS setting and cycles system, light, dark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    const cycle: ThemePref[] = ['system'];
    for (let step = 0; step < 3; step++) cycle.push(nextPref(cycle[step] as ThemePref));
    expect(cycle).toEqual(['system', 'light', 'dark', 'system']);
  });

  it('reads only light and dark from storage and treats a broken storage as system', () => {
    const storage = new MemoryStorage();
    expect(readPref(storage)).toBe('system');
    storage.setItem('theme', 'dark');
    expect(readPref(storage)).toBe('dark');
    storage.setItem('theme', 'blue');
    expect(readPref(storage)).toBe('system');
    expect(readPref(null)).toBe('system');
    expect(
      readPref({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('system');
  });
});

describe('applyTheme', () => {
  it('writes the theme, the preference and one chrome colour for a forced theme', () => {
    expect(applyTheme(document, 'dark', false)).toBe('dark');
    expect(state()).toEqual({ theme: 'dark', pref: 'dark' });
    expect(metas()).toEqual(['#16161e', '#16161e']);
  });

  it('restores the per-scheme chrome colours for system', () => {
    applyTheme(document, 'light', true);
    applyTheme(document, 'system', true);
    expect(state()).toEqual({ theme: 'dark', pref: 'system' });
    expect(metas()).toEqual(['#e6e9ef', '#16161e']);
  });

  it('announces every change', () => {
    const seen: unknown[] = [];
    document.addEventListener('themechange', (event) => seen.push((event as CustomEvent).detail));
    applyTheme(document, 'light', true);
    expect(seen).toEqual([{ theme: 'light', pref: 'light' }]);
  });
});

describe('initTheme', () => {
  it('cycles on click, stores the choice and reports it', () => {
    const storage = new MemoryStorage();
    const theme = initTheme(document, { storage, media: media(true) });
    expect(state()).toEqual({ theme: 'dark', pref: 'system' });
    const button = document.querySelector('[data-theme-toggle]') as HTMLButtonElement;
    button.click();
    expect(state()).toEqual({ theme: 'light', pref: 'light' });
    expect(storage.getItem('theme')).toBe('light');
    button.click();
    expect(state()).toEqual({ theme: 'dark', pref: 'dark' });
    theme.cycle();
    expect(state()).toEqual({ theme: 'dark', pref: 'system' });
    expect(theme.pref()).toBe('system');
    expect(theme.theme()).toBe('dark');
    theme.set('light');
    expect(state()).toEqual({ theme: 'light', pref: 'light' });
  });

  it('follows the system only while the preference is system', () => {
    const system = media(false);
    const theme = initTheme(document, { storage: new MemoryStorage(), media: system });
    system.change(true);
    expect(state()).toEqual({ theme: 'dark', pref: 'system' });
    theme.set('light');
    system.change(false);
    system.change(true);
    expect(state()).toEqual({ theme: 'light', pref: 'light' });
  });

  it('works without storage and when storage refuses writes', () => {
    initTheme(document, { storage: null, media: media(false) });
    (document.querySelector('[data-theme-toggle]') as HTMLButtonElement).click();
    expect(state()).toEqual({ theme: 'light', pref: 'light' });
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    document.body.innerHTML = '<button data-theme-toggle>theme</button>';
    const theme = initTheme(document, { storage: refusing, media: media(false) });
    theme.cycle();
    theme.cycle();
    expect(state()).toEqual({ theme: 'dark', pref: 'dark' });
  });
});
