import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAR_MS,
  defaultEnv,
  INTRO_KEY,
  playIntro,
  STRIKE_GAP_MS,
  STRIKE_MS,
  type IntroEnv,
} from '../../src/scripts/intro';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const BLOCKED = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

const CURSOR = '<span class="cursor" aria-hidden="true">▋</span>';
const SLOGAN = '<span class="slogan-text">Hi 🍻.</span>';
const ITEMS = '<s>Go</s> · <s>Vue</s>';
const NOTE = `<span class="comment" data-note><span class="note-text"> # AI 😎</span>${CURSOR}</span>`;

function card(slogan: string, stack: string): string {
  return `<div class="neofetch" data-intro><p class="slogan" data-slogan>${slogan}</p><dl><div><dt>Stack</dt><dd data-stack>${stack}</dd></div></dl></div>`;
}

const root = () => document.querySelector('[data-intro]') as HTMLElement;
const overlayText = (selector: string) =>
  root().querySelector(`${selector} .typed`)?.textContent ?? '-';

/** One line per wait: its length, what the overlays show and which items are struck. */
function moment(ms: number): string {
  const parked = root().querySelector('[data-slogan] .typed.parked') ? ' (parked)' : '';
  const drawn = [...root().querySelectorAll('[data-stack] s')]
    .map((item) => (item.hasAttribute('data-drawn') ? 'x' : '-'))
    .join('');
  const intro = root().classList.contains('intro') ? '' : ' (no intro class)';
  return `${ms} slogan:${overlayText('[data-slogan]')}${parked} strikes:${drawn} note:${overlayText('[data-note]')}${intro}`;
}

function env(overrides: Partial<IntroEnv> = {}) {
  const moments: string[] = [];
  const value: IntroEnv = {
    storage: new MemoryStorage(),
    reducedMotion: () => false,
    shown: () => Promise.resolve(),
    wait: async (ms) => {
      moments.push(moment(ms));
    },
    ...overrides,
  };
  return { value, moments };
}

beforeEach(() => {
  document.body.innerHTML = card(SLOGAN, ITEMS + NOTE);
});

describe('playIntro', () => {
  it('types the slogan, strikes the items left to right, then types the note, and leaves the card as it was', async () => {
    const before = root().outerHTML;
    const { value, moments } = env();
    await playIntro(root(), value);
    expect(moments).toEqual([
      `${CHAR_MS} slogan:▋ strikes:-- note:-`,
      `${CHAR_MS} slogan:H▋ strikes:-- note:-`,
      `${CHAR_MS} slogan:Hi▋ strikes:-- note:-`,
      `${CHAR_MS} slogan:Hi ▋ strikes:-- note:-`,
      `${CHAR_MS} slogan:Hi 🍻▋ strikes:-- note:-`,
      `${STRIKE_GAP_MS} slogan:Hi 🍻.▋ (parked) strikes:x- note:-`,
      `${STRIKE_MS} slogan:Hi 🍻.▋ (parked) strikes:xx note:-`,
      `${CHAR_MS} slogan:- strikes:xx note:▋`,
      `${CHAR_MS} slogan:- strikes:xx note: ▋`,
      `${CHAR_MS} slogan:- strikes:xx note: #▋`,
      `${CHAR_MS} slogan:- strikes:xx note: # ▋`,
      `${CHAR_MS} slogan:- strikes:xx note: # A▋`,
      `${CHAR_MS} slogan:- strikes:xx note: # AI▋`,
      `${CHAR_MS} slogan:- strikes:xx note: # AI ▋`,
    ]);
    expect(root().outerHTML).toBe(before);
  });

  it('keeps the cursor after the slogan when there is no note', async () => {
    document.body.innerHTML = card(SLOGAN + CURSOR, ITEMS);
    const before = root().outerHTML;
    const { value, moments } = env();
    await playIntro(root(), value);
    expect(moments.slice(4)).toEqual([
      `${CHAR_MS} slogan:Hi 🍻▋ strikes:-- note:-`,
      `${STRIKE_GAP_MS} slogan:- strikes:x- note:-`,
      `${STRIKE_MS} slogan:- strikes:xx note:-`,
    ]);
    expect(root().outerHTML).toBe(before);
  });

  it('goes straight from the slogan to the note when no item is struck', async () => {
    document.body.innerHTML = card(SLOGAN, `Go · Vue${NOTE}`);
    const { value, moments } = env();
    await playIntro(root(), value);
    expect(moments.slice(4, 6)).toEqual([
      `${CHAR_MS} slogan:Hi 🍻▋ strikes: note:-`,
      `${CHAR_MS} slogan:- strikes: note:▋`,
    ]);
  });

  it('hides the typing from screen readers, which read the card itself', async () => {
    const { value } = env({
      wait: async () => {
        const overlays = [...root().querySelectorAll('.typed')];
        expect(overlays.length).toBe(1);
        expect(overlays[0]?.getAttribute('aria-hidden')).toBe('true');
      },
    });
    await playIntro(root(), value);
  });

  it('plays once per browser session', async () => {
    const storage = new MemoryStorage();
    await playIntro(root(), env({ storage }).value);
    expect(storage.items.get(INTRO_KEY)).toBe('1');
    const again = env({ storage });
    await playIntro(root(), again.value);
    expect(again.moments).toEqual([]);
  });

  it('never plays for a visitor who prefers reduced motion', async () => {
    const before = root().outerHTML;
    const storage = new MemoryStorage();
    const { value, moments } = env({ storage, reducedMotion: () => true });
    await playIntro(root(), value);
    expect(moments).toEqual([]);
    expect(storage.items.size).toBe(0);
    expect(root().outerHTML).toBe(before);
  });

  it('plays on every page load when storage is missing or blocked', async () => {
    for (const storage of [null, BLOCKED]) {
      const first = env({ storage });
      await playIntro(root(), first.value);
      const again = env({ storage });
      await playIntro(root(), again.value);
      expect(first.moments).toHaveLength(14);
      expect(again.moments).toEqual(first.moments);
    }
  });

  it('waits until the page is shown', async () => {
    let show: () => void = () => undefined;
    const storage = new MemoryStorage();
    const { value, moments } = env({
      storage,
      shown: () =>
        new Promise((resolve) => {
          show = resolve;
        }),
    });
    const playing = playIntro(root(), value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root().classList.contains('intro')).toBe(false);
    expect(storage.items.size).toBe(0);
    show();
    await playing;
    expect(moments).toHaveLength(14);
  });

  it('puts the card back when a step fails', async () => {
    const before = root().outerHTML;
    for (const failing of [STRIKE_GAP_MS, STRIKE_MS]) {
      const { value } = env({
        wait: async (ms) => {
          if (ms === failing) throw new Error('the timer is gone');
        },
      });
      await expect(playIntro(root(), value)).rejects.toThrow('the timer is gone');
      expect(root().outerHTML).toBe(before);
    }
    let noteSteps = 0;
    const { value } = env({
      wait: async () => {
        if (root().querySelector('[data-note] .typed') && ++noteSteps === 3)
          throw new Error('the timer is gone');
      },
    });
    await expect(playIntro(root(), value)).rejects.toThrow('the timer is gone');
    expect(root().outerHTML).toBe(before);
  });
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('defaultEnv', () => {
  it('waits for a hidden tab to come to the front before it reports the page shown', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    let shown = false;
    const waiting = defaultEnv(document)
      .shown()
      .then(() => {
        shown = true;
      });
    document.dispatchEvent(new Event('visibilitychange'));
    await settled();
    expect(shown).toBe(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waiting;
    expect(shown).toBe(true);
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('waits for prerendering to end before it reports the page shown', async () => {
    Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
    let shown = false;
    const waiting = defaultEnv(document)
      .shown()
      .then(() => {
        shown = true;
      });
    await settled();
    expect(shown).toBe(false);
    Object.defineProperty(document, 'prerendering', { configurable: true, value: false });
    document.dispatchEvent(new Event('prerenderingchange'));
    await waiting;
    expect(shown).toBe(true);
    Reflect.deleteProperty(document, 'prerendering');
  });
});
