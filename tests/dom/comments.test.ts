import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultEnv,
  giscusScript,
  setupComments,
  themeUrl,
  type CommentsEnv,
  type Theme,
} from '../../src/scripts/comments';

const MARKUP =
  '<div class="giscus" data-comments data-repo="lilhorse/lil.horse" data-repo-id="R_x" data-category="Announcements" data-category-id="DIC_x" data-term="douban" data-theme-light="https://lil.horse/giscus/mist.css" data-theme-dark="https://lil.horse/giscus/night.css"></div>';

const container = () => document.querySelector('[data-comments]') as HTMLElement;
const script = () => document.querySelector('script[src="https://giscus.app/client.js"]');

function env(theme: Theme) {
  let near: (() => void) | undefined;
  let release: () => void = () => {};
  const prerendering = new Promise<void>((resolve) => {
    release = resolve;
  });
  const value: CommentsEnv & {
    near(): void;
    release(): void;
    theme(): Theme;
    setTheme(t: Theme): void;
  } = {
    doc: document,
    theme: () => theme,
    setTheme: (next) => {
      theme = next;
    },
    observe: (_target, onNear) => {
      near = onNear;
    },
    prerendered: () => prerendering,
    near: () => near?.(),
    release: () => release(),
  };
  return value;
}

beforeEach(() => {
  document.body.innerHTML = MARKUP;
});

describe('giscusScript', () => {
  it('carries the spec parameters and the current theme', () => {
    const element = giscusScript(document, container(), 'https://lil.horse/giscus/night.css');
    expect(element.src).toBe('https://giscus.app/client.js');
    expect(element.async).toBe(true);
    expect(element.crossOrigin).toBe('anonymous');
    expect(Object.fromEntries([...element.attributes].map((a) => [a.name, a.value]))).toMatchObject(
      {
        'data-repo': 'lilhorse/lil.horse',
        'data-repo-id': 'R_x',
        'data-category': 'Announcements',
        'data-category-id': 'DIC_x',
        'data-mapping': 'specific',
        'data-term': 'douban',
        'data-strict': '1',
        'data-reactions-enabled': '1',
        'data-emit-metadata': '0',
        'data-input-position': 'top',
        'data-theme': 'https://lil.horse/giscus/night.css',
        'data-lang': 'en',
      },
    );
    expect(themeUrl(container(), 'light')).toBe('https://lil.horse/giscus/mist.css');
  });
});

describe('setupComments', () => {
  it('waits for the page to be shown and the section to come near, then loads once', async () => {
    const e = env('dark');
    setupComments(container(), e);
    e.near();
    expect(script()).toBeNull();
    e.release();
    await Promise.resolve();
    await Promise.resolve();
    e.near();
    e.near();
    expect(document.querySelectorAll('script[src="https://giscus.app/client.js"]')).toHaveLength(1);
    expect(script()?.getAttribute('data-theme')).toBe('https://lil.horse/giscus/night.css');
  });

  it('tells the loaded frame about theme changes', async () => {
    const e = env('light');
    setupComments(container(), e);
    e.release();
    await Promise.resolve();
    await Promise.resolve();
    e.near();
    const frame = document.createElement('iframe');
    frame.className = 'giscus-frame';
    container().append(frame);
    const postMessage = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage } });
    e.setTheme('dark');
    document.dispatchEvent(new CustomEvent('themechange'));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      { giscus: { setConfig: { theme: 'https://lil.horse/giscus/night.css' } } },
      'https://giscus.app',
    );
  });
});

describe('defaultEnv', () => {
  it('holds a prerendered page back until it is shown', async () => {
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    let shown = false;
    void defaultEnv(document)
      .prerendered()
      .then(() => {
        shown = true;
      });
    await Promise.resolve();
    expect(shown).toBe(false);
    Object.defineProperty(document, 'prerendering', { value: false, configurable: true });
    document.dispatchEvent(new Event('prerenderingchange'));
    await Promise.resolve();
    expect(shown).toBe(true);
  });
});
