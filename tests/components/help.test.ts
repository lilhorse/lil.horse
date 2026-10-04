import { describe, expect, it } from 'vitest';
import ShortcutsHelp from '../../src/components/shell/ShortcutsHelp.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';

describe('ShortcutsHelp', () => {
  it('lists every shortcut and offers the switch, checked by default', async () => {
    const html = await render(ShortcutsHelp);
    expect(html).toContain('<dialog class="help" data-help aria-labelledby="help-title">');
    expect(html).toContain('<h2 id="help-title">Keyboard shortcuts</h2>');
    expect(html).toContain('<input type="checkbox" data-shortcuts-toggle checked>');
    const rows = [...html.matchAll(/<div class="row">([\s\S]*?)<\/div>/g)].map(([, row]) =>
      textOf(row ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    expect(rows).toEqual([
      '⌘K or CtrlKOpen the command palette',
      '/Search',
      'g then hGo home',
      'g then bGo to the blog',
      'g then pGo to projects',
      'g then aGo to about',
      '[ ]Older or newer post',
      'tSwitch theme',
      '?Show this help',
    ]);
    expect(await htmlErrors(html)).toEqual([]);
  });
});
