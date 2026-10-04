import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mistTheme, nightTheme } from '../../src/styles/code-themes.mjs';
import { contrast, rgb } from '../helpers/color';

// giscus.app/themes/light.css on 2026-10-04; a theme must define every one of these.
const VARIABLES = [
  ...[
    'comment',
    'constant',
    'entity',
    'storage-modifier-import',
    'entity-tag',
    'keyword',
    'string',
    'variable',
    'brackethighlighter-unmatched',
    'invalid-illegal-text',
    'invalid-illegal-bg',
    'carriage-return-text',
    'carriage-return-bg',
    'string-regexp',
    'markup-list',
    'markup-heading',
    'markup-italic',
    'markup-bold',
    'markup-deleted-text',
    'markup-deleted-bg',
    'markup-inserted-text',
    'markup-inserted-bg',
    'markup-changed-text',
    'markup-changed-bg',
    'markup-ignored-text',
    'markup-ignored-bg',
    'meta-diff-range',
    'brackethighlighter-angle',
    'sublimelinter-gutter-mark',
    'constant-other-reference-link',
  ].map((name) => `prettylights-syntax-${name}`),
  ...[
    'text',
    'bg',
    'border',
    'shadow',
    'inset-shadow',
    'hover-bg',
    'hover-border',
    'active-bg',
    'active-border',
    'selected-bg',
    'primary-text',
    'primary-bg',
    'primary-border',
    'primary-shadow',
    'primary-inset-shadow',
    'primary-hover-bg',
    'primary-hover-border',
    'primary-selected-bg',
    'primary-selected-shadow',
    'primary-disabled-text',
    'primary-disabled-bg',
    'primary-disabled-border',
  ].map((name) => `btn-${name}`),
  'action-list-item-default-hover-bg',
  'segmented-control-bg',
  'segmented-control-button-bg',
  'segmented-control-button-selected-border',
  'fg-default',
  'fg-muted',
  'fg-subtle',
  'canvas-default',
  'canvas-overlay',
  'canvas-inset',
  'canvas-subtle',
  'border-default',
  'border-muted',
  'neutral-muted',
  'accent-fg',
  'accent-emphasis',
  'accent-muted',
  'accent-subtle',
  'success-fg',
  'attention-fg',
  'attention-muted',
  'attention-subtle',
  'danger-fg',
  'danger-muted',
  'danger-subtle',
  'primer-shadow-inset',
  'scale-gray-1',
  'scale-blue-1',
  'social-reaction-bg-hover',
  'social-reaction-bg-reacted-hover',
];

const TEXT_ON_FILL = [
  ...[
    'fg-default',
    'fg-muted',
    'fg-subtle',
    'accent-fg',
    'success-fg',
    'attention-fg',
    'danger-fg',
  ].map((text) => [text, 'canvas-default']),
  ['btn-text', 'btn-bg'],
  ['btn-primary-text', 'btn-primary-bg'],
  ...['invalid-illegal', 'carriage-return', 'markup-ignored'].map((name) => [
    `prettylights-syntax-${name}-text`,
    `prettylights-syntax-${name}-bg`,
  ]),
] as const;

const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const tokenValues = (side: 1 | 2) =>
  new Set(
    [...tokens.matchAll(/light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/g)].map((m) => m[side]),
  );
const codeValues = (theme: unknown) => new Set(JSON.stringify(theme).match(/#[0-9a-f]{6}/gi) ?? []);

describe.each([
  ['night', 2, nightTheme],
  ['mist', 1, mistTheme],
] as const)('public/giscus/%s.css', (name, side, code) => {
  const css = readFileSync(`public/giscus/${name}.css`, 'utf8');

  it('defines exactly the variables giscus themes use', () => {
    const defined = [...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(defined).toEqual(VARIABLES);
  });

  it('takes every colour from the theme tokens or the code theme', () => {
    const allowed = new Set([...tokenValues(side), ...codeValues(code)]);
    for (const hex of css.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/g) ?? [])
      expect(allowed, hex).toContain(hex.slice(0, 7));
  });

  it('keeps text at 4.5:1 on the solid fills giscus draws it on', () => {
    const color = (variable: string) => {
      const hex = new RegExp(`--color-${variable}: (#[0-9a-f]{6});`).exec(css)?.[1];
      if (!hex) throw new Error(`--color-${variable} is not a solid colour`);
      return rgb(hex);
    };
    for (const [text, fill] of TEXT_ON_FILL)
      expect(contrast(color(text), color(fill)), `${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
  });
});
