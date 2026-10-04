import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initShortcuts,
  isEditable,
  singleKeysSwitch,
  type ShortcutDeps,
  type SingleKeys,
} from '../../src/scripts/shortcuts';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const refusing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

let calls: string[];
let clock: number;
let storage: MemoryStorage;
let singleKeys: SingleKeys;
let dispose = () => {};

function mount(extra = '', keys?: SingleKeys) {
  dispose();
  document.body.innerHTML = `<input id="field"><div id="note" contenteditable="true"></div>${extra}`;
  calls = [];
  clock = 1000;
  storage = new MemoryStorage();
  singleKeys = keys ?? singleKeysSwitch(storage);
  const deps: ShortcutDeps = {
    singleKeys,
    openPalette: () => calls.push('palette'),
    openHelp: () => calls.push('help'),
    cycleTheme: () => calls.push('theme'),
    navigate: (href) => calls.push(`go ${href}`),
    now: () => clock,
  };
  dispose = initShortcuts(document, deps);
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => mount());

afterEach(() => dispose());

describe('switch', () => {
  it('is on until the visitor stores off', () => {
    expect(singleKeys.enabled()).toBe(true);
    singleKeys.set(false);
    expect(storage.getItem('shortcuts')).toBe('off');
    expect(singleKeys.enabled()).toBe(false);
    expect(singleKeysSwitch(storage).enabled()).toBe(false);
    singleKeys.set(true);
    expect(singleKeys.enabled()).toBe(true);
    expect(singleKeysSwitch(null).enabled()).toBe(true);
    expect(singleKeysSwitch(refusing).enabled()).toBe(true);
  });

  it('keeps the choice for the page when storage is unavailable', () => {
    for (const unavailable of [null, refusing]) {
      const keys = singleKeysSwitch(unavailable);
      keys.set(false);
      expect(keys.enabled()).toBe(false);
      keys.set(true);
      expect(keys.enabled()).toBe(true);
    }
  });

  it('recognises form fields and editable regions', () => {
    expect(isEditable(document.querySelector('#field'))).toBe(true);
    expect(isEditable(document.body)).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe('keys', () => {
  it('opens the palette with ⌘K, Ctrl+K and /', () => {
    expect(press('k', { metaKey: true }).defaultPrevented).toBe(true);
    press('K', { ctrlKey: true });
    expect(press('/').defaultPrevented).toBe(true);
    expect(calls).toEqual(['palette', 'palette', 'palette']);
  });

  it('goes places with g followed by a letter within a second', () => {
    press('g');
    clock += 999;
    press('b');
    expect(calls).toEqual(['go /blog']);
    press('g');
    clock += 1001;
    press('h');
    expect(calls).toEqual(['go /blog']);
    press('g');
    press('x');
    press('h');
    expect(calls).toEqual(['go /blog']);
    press('g');
    press('p');
    press('g');
    press('a');
    expect(calls).toEqual(['go /blog', 'go /projects', 'go /about']);
  });

  it('follows the prev and next links of the page', () => {
    mount(
      '<nav><a rel="prev" href="/blog/old">old</a><a rel="next" href="/blog/new">new</a></nav>',
    );
    press('[');
    press(']');
    expect(calls).toEqual([
      'go http://localhost:3000/blog/old',
      'go http://localhost:3000/blog/new',
    ]);
    mount();
    press('[');
    expect(calls).toEqual([]);
  });

  it('switches the theme with t and shows the help with ?', () => {
    press('t');
    expect(press('?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(calls).toEqual(['theme', 'help']);
  });
});

describe('when single keys must stay quiet', () => {
  it('ignores keys typed into fields and editable regions', () => {
    const field = document.querySelector('#field') as HTMLInputElement;
    press('t', {}, field);
    press('/', {}, field);
    press('g', {}, document.querySelector('#note') as HTMLElement);
    press('b', {}, document.querySelector('#note') as HTMLElement);
    expect(calls).toEqual([]);
    press('k', { metaKey: true }, field);
    expect(calls).toEqual(['palette']);
  });

  it('ignores keys while a dialog is open', () => {
    mount('<dialog open></dialog>');
    press('t');
    press('?');
    press('k', { ctrlKey: true });
    expect(calls).toEqual(['palette']);
  });

  it('ignores modified keys and keys another handler already took', () => {
    press('t', { altKey: true });
    press('t', { ctrlKey: true });
    const taken = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true });
    taken.preventDefault();
    document.body.dispatchEvent(taken);
    expect(calls).toEqual([]);
  });

  it('keeps only ⌘K and Ctrl+K once the visitor switches shortcuts off', () => {
    singleKeys.set(false);
    press('t');
    press('/');
    press('g');
    press('b');
    press('?');
    expect(calls).toEqual([]);
    press('k', { metaKey: true });
    expect(calls).toEqual(['palette']);
  });

  it('stays switched off without storage', () => {
    mount('', singleKeysSwitch(null));
    singleKeys.set(false);
    press('t');
    press('?');
    expect(calls).toEqual([]);
  });
});
