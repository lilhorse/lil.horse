import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, mixOklab, rgb, type Rgb } from '../helpers/color';

type Theme = 'light' | 'dark';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const MIX = /^color-mix\(in oklab, (#[0-9a-f]{6}) (\d+)%, var\(--bg\)\)$/;

function token(name: string): Record<Theme, string> {
  const match = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (.+)\\);`).exec(css);
  if (!match?.[1] || !match[2]) throw new Error(`--${name} is not a light-dark() token`);
  return { light: match[1], dark: match[2] };
}

function color(name: string, theme: Theme): Rgb {
  const value = token(name)[theme];
  const mix = MIX.exec(value);
  return mix?.[1] && mix[2] ? mixOklab(mix[1], token('bg')[theme], Number(mix[2])) : rgb(value);
}

const VALUES: Record<string, [string, string]> = {
  bg: ['#f2f4f7', '#1a1b26'],
  'bg-bar': ['#e6e9ef', '#16161e'],
  'bg-code': ['#eaedf2', '#16161e'],
  border: ['#d8dde6', '#292e42'],
  rule: ['#e4e8ee', '#222436'],
  fg: ['#1f1b16', '#c0caf5'],
  'fg-soft': ['#3d362d', '#a9b1d6'],
  muted: ['#6b6152', '#8089b3'],
  faint: ['#aab1bf', '#565f89'],
  'heading-mark': ['#c92a2a', '#565f89'],
  accent: ['#1f4fd6', '#7aa2f7'],
  'accent-2': ['#a35530', '#bb9af7'],
  prompt: ['#c92a2a', '#9ece6a'],
  branch: ['#c92a2a', '#bb9af7'],
  user: ['#a35530', '#7dcfff'],
  ok: ['#2f7a2f', '#9ece6a'],
  danger: ['#c92a2a', '#f7768e'],
  star: ['#c92a2a', '#e0af68'],
  'hl-yellow': ['#ffe27a', 'color-mix(in oklab, #e0af68 22%, var(--bg))'],
  'hl-pink': ['#ffc2d9', 'color-mix(in oklab, #f7768e 22%, var(--bg))'],
  'hl-green': ['#c4efb0', 'color-mix(in oklab, #9ece6a 22%, var(--bg))'],
  'hl-blue': ['#c9e2ff', 'color-mix(in oklab, #7aa2f7 22%, var(--bg))'],
};

const TEXT_ON_BG = [
  'fg',
  'fg-soft',
  'muted',
  'accent',
  'accent-2',
  'prompt',
  'branch',
  'user',
  'ok',
  'danger',
  'star',
  'text-brown',
  'text-orange',
  'text-yellow',
  'text-purple',
];
const TEXT_ON_BAR = ['fg', 'muted', 'accent'];
const HIGHLIGHTS = ['hl-yellow', 'hl-pink', 'hl-green', 'hl-blue'];
const TAGS = ['yellow', 'pink', 'green', 'blue'];

describe('colour tokens', () => {
  it('keep their light and dark values', () => {
    for (const [name, [light, dark]] of Object.entries(VALUES))
      expect(token(name), name).toEqual({ light, dark });
  });

  it.each(['light', 'dark'] as const)('keep information text at 4.5:1 or more (%s)', (theme) => {
    const pairs: [string, string][] = [
      ...TEXT_ON_BG.map((name): [string, string] => [name, 'bg']),
      ...TEXT_ON_BAR.map((name): [string, string] => [name, 'bg-bar']),
      ['fg', 'bg-code'],
      ['muted', 'bg-code'],
      ...HIGHLIGHTS.map((name): [string, string] => ['fg', name]),
      ['accent', 'hl-yellow'],
      ...TAGS.map((name): [string, string] => [`tag-${name}-fg`, `tag-${name}-bg`]),
    ];
    for (const [text, background] of pairs) {
      const ratio = contrast(color(text, theme), color(background, theme));
      expect(ratio, `${text} on ${background}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keep the decorative --faint below the text threshold, so it never carries information', () => {
    for (const theme of ['light', 'dark'] as const)
      expect(contrast(color('faint', theme), color('bg', theme))).toBeLessThan(4.5);
  });
});

describe('page frame', () => {
  const textColors = (component: string): Set<string> => {
    const source = readFileSync(`src/components/shell/${component}.astro`, 'utf8');
    return new Set(
      [...source.matchAll(/(?<![\w-])color: var\(--([\w-]+)\)/g)].map((match) => match[1] ?? ''),
    );
  };

  it.each(['light', 'dark'] as const)(
    'keeps the header, menu and footer text at 4.5:1 or more on the bar (%s)',
    (theme) => {
      for (const component of ['SiteHeader', 'SiteMenu', 'SiteFooter']) {
        const names = textColors(component);
        expect(names.size, component).toBeGreaterThan(0);
        for (const name of names) {
          const ratio = contrast(color(name, theme), color('bg-bar', theme));
          expect(
            ratio,
            `${component}: ${name} on bg-bar: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );
});
