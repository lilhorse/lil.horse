export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'theme';
export const BAR_COLORS: Record<Theme, string> = { light: '#e6e9ef', dark: '#16161e' };
const ORDER: readonly ThemePref[] = ['system', 'light', 'dark'];

/** The parts of matchMedia('(prefers-color-scheme: dark)') the theme needs. */
export interface SystemScheme {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

export interface ThemeEnv {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  media: SystemScheme;
}

export interface ThemeController {
  pref(): ThemePref;
  theme(): Theme;
  set(pref: ThemePref): void;
  cycle(): void;
}

export function readPref(storage: Pick<Storage, 'getItem'> | null): ThemePref {
  try {
    const stored = storage?.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function nextPref(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length] ?? 'system';
}

/** Writes the resolved theme to <html> and the browser-chrome colour, then tells listeners. */
export function applyTheme(doc: Document, pref: ThemePref, systemDark: boolean): Theme {
  const theme = resolveTheme(pref, systemDark);
  const root = doc.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own: Theme = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', BAR_COLORS[pref === 'system' ? own : theme]);
  }
  doc.dispatchEvent(new CustomEvent('themechange', { detail: { theme, pref } }));
  return theme;
}

export function initTheme(doc: Document, env: ThemeEnv): ThemeController {
  let pref = readPref(env.storage);
  const apply = () => applyTheme(doc, pref, env.media.matches);
  const set = (next: ThemePref) => {
    pref = next;
    try {
      env.storage?.setItem(THEME_KEY, next);
    } catch {
      // Private browsing may refuse writes; the choice then lasts for this page only.
    }
    apply();
  };
  for (const button of doc.querySelectorAll('[data-theme-toggle]'))
    button.addEventListener('click', () => set(nextPref(pref)));
  env.media.addEventListener('change', () => {
    if (pref === 'system') apply();
  });
  apply();
  return {
    pref: () => pref,
    theme: () => resolveTheme(pref, env.media.matches),
    set,
    cycle: () => set(nextPref(pref)),
  };
}
