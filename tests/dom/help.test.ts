import { beforeEach, describe, expect, it } from 'vitest';
import { setupHelp, type Help } from '../../src/scripts/help';
import { singleKeysSwitch } from '../../src/scripts/shortcuts';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

let storage: MemoryStorage;
let help: Help;
const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const toggle = () => document.querySelector('[data-shortcuts-toggle]') as HTMLInputElement;

const MARKUP =
  '<dialog data-help><button type="button" data-help-close>esc</button><label><input type="checkbox" data-shortcuts-toggle checked> Single-key shortcuts</label></dialog>';

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  storage = new MemoryStorage();
  help = setupHelp(dialog(), singleKeysSwitch(storage));
});

describe('setupHelp', () => {
  it('opens with the switch reflecting the stored choice', () => {
    storage.setItem('shortcuts', 'off');
    help.open();
    expect(dialog().open).toBe(true);
    expect(toggle().checked).toBe(false);
  });

  it('stores the switch when it changes', () => {
    help.open();
    toggle().checked = false;
    toggle().dispatchEvent(new Event('change'));
    expect(storage.getItem('shortcuts')).toBe('off');
    toggle().checked = true;
    toggle().dispatchEvent(new Event('change'));
    expect(storage.getItem('shortcuts')).toBe('on');
  });

  it('shows the switch as left for the page when storage is unavailable', () => {
    document.body.innerHTML = MARKUP;
    const withoutStorage = setupHelp(dialog(), singleKeysSwitch(null));
    withoutStorage.open();
    toggle().checked = false;
    toggle().dispatchEvent(new Event('change'));
    dialog().close();
    toggle().checked = true;
    withoutStorage.open();
    expect(toggle().checked).toBe(false);
  });

  it('closes from the button and the backdrop', () => {
    help.open();
    (document.querySelector('[data-help-close]') as HTMLButtonElement).click();
    expect(dialog().open).toBe(false);
    help.open();
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog().open).toBe(false);
  });
});
