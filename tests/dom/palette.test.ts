import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPalette, type Palette, type PaletteDeps } from '../../src/scripts/palette';
import type { Searcher } from '../../src/scripts/search';
import type { ThemeController, ThemePref } from '../../src/scripts/theme';

// Mirrors the attributes CommandPalette.astro renders; the component test pins that markup.
const MARKUP = `<dialog data-palette data-email-user="sup" data-email-host="lil.horse">
  <input id="q" type="text" role="combobox">
  <button type="button" data-palette-close>esc</button>
  <div role="group">
    <button type="button" data-theme-set="system"></button>
    <button type="button" data-theme-set="light"></button>
    <button type="button" data-theme-set="dark"></button>
  </div>
  <ul role="listbox">
    <li data-group="results" hidden><ul data-results></ul></li>
    <li data-group="nav"><ul>
      <li role="option" id="nav-home" data-href="/" data-keywords="go to"><span class="label">home</span></li>
      <li role="option" id="nav-blog" data-href="/blog" data-keywords="go to"><span class="label">blog</span></li>
    </ul></li>
    <li data-group="actions"><ul>
      <li role="option" id="act-theme" data-action="theme" data-keywords="theme"><span class="label">Switch theme</span> <span data-theme-hint></span></li>
      <li role="option" id="act-copy" data-action="copy-email" data-keywords="copy email"><span class="label">Copy email</span></li>
      <li role="option" id="act-email" data-action="email" data-keywords="email me"><span class="label">Email me</span></li>
    </ul></li>
  </ul>
  <p role="status"></p>
</dialog>`;

function fakeTheme() {
  let pref: ThemePref = 'system';
  const calls: string[] = [];
  const theme: ThemeController = {
    pref: () => pref,
    theme: () => 'light',
    set(next) {
      pref = next;
      calls.push(`set:${next}`);
      document.dispatchEvent(new CustomEvent('themechange'));
    },
    cycle() {
      calls.push('cycle');
    },
  };
  return { theme, calls };
}

function fakeSearcher(hits: Record<string, string[]>): Searcher {
  return {
    async search(query) {
      return {
        results: (hits[query] ?? []).map((url) => ({
          data: async () => ({
            url,
            excerpt: `about <mark>${query}</mark>`,
            meta: { title: `Title ${url}`, date: '2024-01-11', lang: 'zh-Hans' },
          }),
        })),
      };
    },
  };
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const input = () => document.querySelector('input') as HTMLInputElement;
const visible = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .filter((option) => !option.hidden && !option.closest('[hidden]'))
    .map((option) => option.id);
const active = () => document.querySelector('[role="option"][aria-selected="true"]')?.id;
const status = () => document.querySelector('[role="status"]')?.textContent;
const type = async (text: string) => {
  input().value = text;
  input().dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(150);
};
const key = (name: string) =>
  input().dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );

let navigated: string[];
let copied: string[];
let palette: Palette;
let themeCalls: string[];

function mount(overrides: Partial<PaletteDeps> = {}) {
  document.body.innerHTML = MARKUP;
  navigated = [];
  copied = [];
  const { theme, calls } = fakeTheme();
  themeCalls = calls;
  palette = setupPalette(dialog(), {
    theme,
    navigate: (href) => navigated.push(href),
    copy: async (text) => {
      copied.push(text);
    },
    loadSearch: async () =>
      fakeSearcher({
        'the bear': ['/blog/douban.html', '/blog/other.html'],
        hello: ['/about.html'],
      }),
    ...overrides,
  });
  palette.open();
}

beforeEach(() => {
  vi.useFakeTimers();
  mount();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening', () => {
  it('shows every command with the first one active and the search box focused', () => {
    expect(dialog().open).toBe(true);
    expect(visible()).toEqual(['nav-home', 'nav-blog', 'act-theme', 'act-copy', 'act-email']);
    expect(active()).toBe('nav-home');
    expect(input().getAttribute('aria-activedescendant')).toBe('nav-home');
    expect(document.activeElement).toBe(input());
    expect(document.querySelector('[data-theme-hint]')?.textContent).toBe('system → light');
  });

  it('closes from the esc button and from a click on the backdrop', () => {
    (document.querySelector('[data-palette-close]') as HTMLButtonElement).click();
    expect(dialog().open).toBe(false);
    palette.open();
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog().open).toBe(false);
  });

  it('opens again without the answers to searches made before it closed', async () => {
    mount({
      loadSearch: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(fakeSearcher({ hello: ['/about.html'] })), 100);
        }),
    });
    await type('hello');
    input().value = 'hello!';
    input().dispatchEvent(new Event('input'));
    palette.close();
    palette.open();
    await vi.advanceTimersByTimeAsync(300);
    expect(visible()).toEqual(['nav-home', 'nav-blog', 'act-theme', 'act-copy', 'act-email']);
  });
});

describe('typing', () => {
  it('filters commands at once and searches after the debounce', async () => {
    input().value = 'the bear';
    input().dispatchEvent(new Event('input'));
    expect(visible()).toEqual([]);
    expect(status()).toBe('');
    await vi.advanceTimersByTimeAsync(150);
    expect(visible()).toEqual(['palette-result-0', 'palette-result-1']);
    expect(active()).toBe('palette-result-0');
    const first = document.querySelector('#palette-result-0') as HTMLElement;
    expect(first.dataset.href).toBe('/blog/douban');
    expect(first.querySelector('.label')?.textContent).toBe('Title /blog/douban.html');
    expect(first.querySelector('.label')?.getAttribute('lang')).toBe('zh-Hans');
    expect(first.querySelector('.excerpt')?.innerHTML).toBe('about <mark>the bear</mark>');
    expect(status()).toBe('');
  });

  it('matches commands by their keywords', async () => {
    await type('mail');
    expect(visible()).toEqual(['act-copy', 'act-email']);
    await type('go');
    expect(visible()).toEqual(['nav-home', 'nav-blog']);
  });

  it('says so in a status outside the listbox when nothing matches, and clears it', async () => {
    await type('zzz');
    expect(visible()).toEqual([]);
    expect(status()).toBe('No results');
    expect(document.querySelector('[role="listbox"] [role="status"]')).toBeNull();
    await type('');
    expect(status()).toBe('');
    await type('zzz');
    palette.close();
    palette.open();
    expect(status()).toBe('');
  });

  it('explains when the search index cannot be loaded, with options only in the list', async () => {
    mount({ loadSearch: async () => null });
    await type('hello');
    expect(status()).toBe('Search is not available on this page.');
    expect(
      [...document.querySelectorAll('[data-results] > *')].map((item) => item.getAttribute('role')),
    ).toEqual([]);
    await type('blog');
    expect(visible()).toEqual(['nav-blog']);
    expect(status()).toBe('Search is not available on this page.');
  });

  it('ignores the answer to a query that is no longer current', async () => {
    input().value = 'hello';
    input().dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(100);
    input().value = 'the bear';
    input().dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(150);
    expect(visible()).toEqual(['palette-result-0', 'palette-result-1']);
  });

  it('activates a command again once clearing the query removes the results', async () => {
    await type('the bear');
    expect(active()).toBe('palette-result-0');
    await type('');
    expect(active()).toBe('nav-home');
    key('Enter');
    expect(navigated).toEqual(['/']);
  });
});

describe('keyboard', () => {
  it('moves with the arrows, wraps, and runs the active option with Enter', () => {
    key('ArrowDown');
    expect(active()).toBe('nav-blog');
    key('ArrowUp');
    key('ArrowUp');
    expect(active()).toBe('act-email');
    key('ArrowDown');
    key('ArrowDown');
    expect(active()).toBe('nav-blog');
    key('Enter');
    expect(navigated).toEqual(['/blog']);
    expect(dialog().open).toBe(false);
  });

  it('runs the first visible option when Enter follows a filter', async () => {
    await type('blog');
    key('Enter');
    expect(navigated).toEqual(['/blog']);
  });

  it('leaves the keys to an input method that is composing', () => {
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const name of ['ArrowDown', 'Enter'])
        input().dispatchEvent(
          new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
        );
    }
    expect(active()).toBe('nav-home');
    expect(navigated).toEqual([]);
    expect(dialog().open).toBe(true);
  });
});

describe('actions', () => {
  it('switches the theme from the action and from the segmented control', () => {
    (document.querySelector('#act-theme') as HTMLElement).click();
    expect(themeCalls).toEqual(['cycle']);
    (document.querySelector('[data-theme-set="dark"]') as HTMLButtonElement).click();
    expect(themeCalls).toEqual(['cycle', 'set:dark']);
    expect(
      [...document.querySelectorAll('[data-theme-set]')].map((button) =>
        button.getAttribute('aria-pressed'),
      ),
    ).toEqual(['false', 'false', 'true']);
    expect(document.querySelector('[data-theme-hint]')?.textContent).toBe('dark → system');
    expect(dialog().open).toBe(true);
  });

  it('builds the address at runtime for both email commands', async () => {
    (document.querySelector('#act-copy') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copied).toEqual(['sup@lil.horse']);
    expect(document.querySelector('#act-copy .label')?.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('#act-copy .label')?.textContent).toBe('Copy email');
    (document.querySelector('#act-email') as HTMLElement).click();
    expect(navigated).toEqual(['mailto:sup@lil.horse']);
    expect(dialog().open).toBe(false);
  });

  it('puts the copy label back after a second copy', async () => {
    const copy = document.querySelector('#act-copy') as HTMLElement;
    copy.click();
    await vi.advanceTimersByTimeAsync(500);
    copy.click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(copied).toEqual(['sup@lil.horse', 'sup@lil.horse']);
    expect(document.querySelector('#act-copy .label')?.textContent).toBe('Copy email');
  });

  it('says so when the browser refuses the copy', async () => {
    mount({ copy: () => Promise.reject(new DOMException('Write permission denied')) });
    (document.querySelector('#act-copy') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#act-copy .label')?.textContent).toBe('Copy failed');
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelector('#act-copy .label')?.textContent).toBe('Copy email');
  });
});
