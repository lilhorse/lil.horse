import { defineEcConfig } from 'astro-expressive-code';
import { mistTheme, nightTheme } from './src/styles/code-themes.mjs';

export default defineEcConfig({
  themes: [nightTheme, mistTheme],
  minSyntaxHighlightingColorContrast: 4.5,
  themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
  styleOverrides: {
    borderRadius: '8px',
    borderWidth: '1px',
    codeFontFamily: 'var(--font-mono)',
    codeFontSize: '0.875rem',
    codeLineHeight: '1.6',
    uiFontFamily: 'var(--font-mono)',
    uiFontSize: '0.8125rem',
    frames: { frameBoxShadowCssValue: 'none' },
  },
});
