import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAR_MS,
  defaultEnv,
  SLOGAN_KEY,
  typeSlogan,
  type SloganEnv,
} from '../../src/scripts/slogan';

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

const slogan = () => document.querySelector('[data-slogan]') as HTMLElement;
const overlay = () => slogan().querySelector('.slogan-typed');

/** Records what the typed overlay shows before each character, and what the page still holds. */
function env(overrides: Partial<SloganEnv> = {}) {
  const frames: string[] = [];
  const value: SloganEnv = {
    storage: new MemoryStorage(),
    reducedMotion: () => false,
    shown: () => Promise.resolve(),
    wait: async (ms) => {
      expect(ms).toBe(CHAR_MS);
      expect(slogan().querySelector('.slogan-text')?.textContent).toBe('Hi 🍻.');
      expect(slogan().classList.contains('typing')).toBe(true);
      frames.push(overlay()?.textContent ?? '');
    },
    ...overrides,
  };
  return { value, frames };
}

beforeEach(() => {
  document.body.innerHTML =
    '<p class="slogan" data-slogan><span class="slogan-text">Hi 🍻.</span><span class="cursor" aria-hidden="true">▋</span></p>';
});

describe('typeSlogan', () => {
  it('types the slogan out a whole character at a time, then leaves the page as it was', async () => {
    const before = slogan().outerHTML;
    const { value, frames } = env();
    await typeSlogan(slogan(), value);
    expect(frames).toEqual(['▋', 'H▋', 'Hi▋', 'Hi ▋', 'Hi 🍻▋']);
    expect(slogan().outerHTML).toBe(before);
  });

  it('hides the typing from screen readers, which read the slogan in the page', async () => {
    const { value } = env({
      wait: async () => {
        expect(overlay()?.getAttribute('aria-hidden')).toBe('true');
        expect(overlay()?.querySelector('.cursor')).not.toBeNull();
      },
    });
    await typeSlogan(slogan(), value);
  });

  it('types once per browser session', async () => {
    const storage = new MemoryStorage();
    const first = env({ storage });
    await typeSlogan(slogan(), first.value);
    expect(storage.items.get(SLOGAN_KEY)).toBe('1');

    const second = env({ storage });
    await typeSlogan(slogan(), second.value);
    expect(second.frames).toEqual([]);
  });

  it('never types for a visitor who prefers reduced motion', async () => {
    const storage = new MemoryStorage();
    const { value, frames } = env({ storage, reducedMotion: () => true });
    await typeSlogan(slogan(), value);
    expect(frames).toEqual([]);
    expect(storage.items.size).toBe(0);
  });

  it('types on every page load when storage is missing or blocked', async () => {
    for (const storage of [null, BLOCKED]) {
      const { value, frames } = env({ storage });
      await typeSlogan(slogan(), value);
      expect(frames).toHaveLength(5);
      const again = env({ storage });
      await typeSlogan(slogan(), again.value);
      expect(again.frames).toHaveLength(5);
    }
  });

  it('waits until a prerendered page is shown', async () => {
    let show: () => void = () => undefined;
    const storage = new MemoryStorage();
    const { value, frames } = env({
      storage,
      shown: () =>
        new Promise((resolve) => {
          show = resolve;
        }),
    });
    const typing = typeSlogan(slogan(), value);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay()).toBeNull();
    expect(storage.items.size).toBe(0);
    show();
    await typing;
    expect(frames).toHaveLength(5);
  });
});

describe('defaultEnv', () => {
  it('waits for prerendering to end before it reports the page shown', async () => {
    Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
    let shown = false;
    const waiting = defaultEnv(document)
      .shown()
      .then(() => {
        shown = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown).toBe(false);
    Object.defineProperty(document, 'prerendering', { configurable: true, value: false });
    document.dispatchEvent(new Event('prerenderingchange'));
    await waiting;
    expect(shown).toBe(true);
    Reflect.deleteProperty(document, 'prerendering');
  });
});
