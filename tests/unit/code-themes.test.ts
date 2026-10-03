import { describe, expect, it } from 'vitest';
import { mistTheme, nightTheme } from '../../src/styles/code-themes.mjs';
import { contrast, rgb } from '../helpers/color';

type Theme = typeof nightTheme;

const foreground = (theme: Theme, scope: string) =>
  theme.tokenColors.find((rule) => rule.scope.includes(scope))?.settings;

describe('code themes', () => {
  it.each([
    ['night', nightTheme, ['#bb9af7', '#7aa2f7', '#9ece6a', '#ff9e64', '#8089b3']],
    ['mist', mistTheme, ['#c92a2a', '#1f4fd6', '#2f7a2f', '#a35530', '#6b6152']],
  ] as const)(
    '%s colours keywords, functions, strings, numbers and comments',
    (_, theme, colours) => {
      expect(
        ['keyword', 'entity.name.function', 'string', 'constant.numeric', 'comment'].map(
          (scope) => foreground(theme, scope)?.foreground,
        ),
      ).toEqual(colours);
    },
  );

  it('italicises comments in the light theme only', () => {
    expect(foreground(mistTheme, 'comment')?.fontStyle).toBe('italic');
    expect(foreground(nightTheme, 'comment')?.fontStyle).toBe('');
  });

  it('draws code on the code background with the main text colour', () => {
    expect([
      nightTheme.colors['editor.background'],
      nightTheme.colors['editor.foreground'],
    ]).toEqual(['#16161e', '#c0caf5']);
    expect([mistTheme.colors['editor.background'], mistTheme.colors['editor.foreground']]).toEqual([
      '#eaedf2',
      '#1f1b16',
    ]);
  });

  it.each([nightTheme, mistTheme])(
    'keeps every token at 4.5:1 on the background ($name)',
    (theme) => {
      const background = rgb(theme.colors['editor.background']);
      for (const rule of theme.tokenColors)
        expect(contrast(rgb(rule.settings.foreground), background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
