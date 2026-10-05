import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_INIT_SCRIPT } from '../../src/lib/theme-init';
import { INTRO_KEY } from '../../src/scripts/intro';
import { BAR_COLORS } from '../../src/scripts/theme';

const run = () => new Function(THEME_INIT_SCRIPT)();
const metas = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#e6e9ef" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#16161e" media="(prefers-color-scheme: dark)">';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePref;
  delete document.documentElement.dataset.introPending;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('THEME_INIT_SCRIPT', () => {
  it('uses the bar colours from tokens.css', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const match = /--bg-bar: light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/.exec(tokens);
    expect(match?.slice(1)).toEqual([BAR_COLORS.light, BAR_COLORS.dark]);
    expect(THEME_INIT_SCRIPT).toContain(BAR_COLORS.light);
    expect(THEME_INIT_SCRIPT).toContain(BAR_COLORS.dark);
  });

  it('follows the system when nothing is stored', () => {
    run();
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', themePref: 'system' });
    expect(metas()).toEqual(['#e6e9ef', '#16161e']);
  });

  it('applies a stored theme and recolours the browser chrome', () => {
    localStorage.setItem('theme', 'light');
    run();
    expect(document.documentElement.dataset).toMatchObject({ theme: 'light', themePref: 'light' });
    expect(metas()).toEqual(['#e6e9ef', '#e6e9ef']);
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem('theme', 'sepia');
    run();
    expect(document.documentElement.dataset.themePref).toBe('system');
  });
});

describe('the intro mark', () => {
  const prefers = (reducedMotion: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion') ? reducedMotion : false,
    }));
  const pending = () => document.documentElement.dataset.introPending;

  it('marks the page while the intro has yet to play in this session', () => {
    prefers(false);
    run();
    expect(pending()).toBe('');
  });

  it('leaves the page alone once the intro has played', () => {
    prefers(false);
    sessionStorage.setItem(INTRO_KEY, '1');
    run();
    expect(pending()).toBeUndefined();
  });

  it('leaves the page alone for a visitor who prefers reduced motion', () => {
    prefers(true);
    run();
    expect(pending()).toBeUndefined();
  });

  it('marks the page when session storage is blocked, as the intro then plays on every load', () => {
    prefers(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    run();
    expect(pending()).toBe('');
    expect(document.documentElement.dataset.themePref).toBe('system');
    vi.restoreAllMocks();
  });
});
