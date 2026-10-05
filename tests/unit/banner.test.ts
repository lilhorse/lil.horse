import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_COLORS,
  BANNER_FONT,
  bannerBitmap,
  bannerImageSize,
  bannerLabel,
  bannerPath,
  bannerScale,
  bannerSvg,
  fontCoverage,
  type Bitmap,
} from '../../src/lib/banner';

/** A bitmap drawn with `#` for a lit pixel and `.` for a dark one. */
function bitmap(...rows: string[]): Bitmap {
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height: rows.length,
    pixels: Uint8Array.from(rows.flatMap((row) => [...row].map((cell) => (cell === '#' ? 1 : 0)))),
  };
}

const TITLE = '𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊';

const GRADIENT = (stops: readonly string[]) =>
  stops.map((color, index) => `<stop offset="${index * 20}%" stop-color="${color}"/>`).join('');

/** The alpha of every pixel resvg draws, so a broken file fails to parse here. */
const drawnAlpha = (svg: string) => {
  const { pixels } = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  return pixels.filter((_, index) => index % 4 === 3);
};

describe('bannerSvg', () => {
  it('draws the dark banner with its swatches and a soft glow, padded for the glow', () => {
    expect(bannerSvg(bitmap('#.', '##'), TITLE, 'dark')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 8 8" width="32" height="32" shape-rendering="crispEdges">' +
        '<title>Lil’Horse</title><defs>' +
        `<linearGradient id="swatches" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="2" y2="0">${GRADIENT(BANNER_COLORS.dark.swatches)}</linearGradient>` +
        '<filter id="glow" filterUnits="userSpaceOnUse" x="-3" y="-3" width="8" height="8" color-interpolation-filters="sRGB">' +
        '<feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#bb9af7" flood-opacity="0.45"/></filter></defs>' +
        '<path fill="url(#swatches)" filter="url(#glow)" d="M0 0h1v1h-1zM0 1h2v1h-2z"/></svg>\n',
    );
  });

  it('gives the light banner a thin edge under its soft shadow', () => {
    const svg = bannerSvg(bitmap('#.', '##'), TITLE, 'light');
    expect(svg).toContain(GRADIENT(BANNER_COLORS.light.swatches));
    expect(svg).toContain(
      '<feDropShadow dx="0" dy="0" stdDeviation="0.25" flood-color="#1f1b16" flood-opacity="0.45"/>' +
        '<feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#1f1b16" flood-opacity="0.22"/>',
    );
  });

  it('escapes the title it names the image with', () => {
    expect(bannerSvg(bitmap('#'), 'A & <B>', 'dark')).toContain('<title>A &amp; &lt;B&gt;</title>');
  });

  it('is a valid, empty image when the font can draw none of the title', () => {
    const svg = bannerSvg(bitmap(), '小马', 'light');
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 6 6" width="24" height="24" shape-rendering="crispEdges"><title>小马</title></svg>\n',
    );
    expect(drawnAlpha(svg).every((alpha) => alpha === 0)).toBe(true);
  });

  it('draws today’s title in both themes', () => {
    const banner = bannerBitmap(TITLE, vi.fn());
    for (const theme of ['dark', 'light'] as const)
      expect(drawnAlpha(bannerSvg(banner, TITLE, theme)).some((alpha) => alpha > 0)).toBe(true);
  });

  it('is four screen pixels per bitmap pixel, padding included', () => {
    expect(bannerImageSize({ width: 72, height: 14 })).toEqual({ width: 312, height: 80 });
  });
});

describe('BANNER_COLORS', () => {
  it('copies the swatches and the text colour of both themes from tokens.css', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    const token = (name: string) => {
      const match = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\);`).exec(
        css,
      );
      if (!match?.[1] || !match[2]) throw new Error(`--${name} is not a light-dark() hex pair`);
      return { light: match[1], dark: match[2] };
    };
    for (const theme of ['light', 'dark'] as const) {
      expect(BANNER_COLORS[theme].swatches, theme).toEqual(
        [1, 2, 3, 4, 5, 6].map((swatch) => token(`swatch-${swatch}`)[theme]),
      );
      expect(BANNER_COLORS[theme].text, theme).toBe(token('fg')[theme]);
    }
  });
});

describe('bannerPath', () => {
  it('draws each run of lit pixels in a row as one rectangle', () => {
    expect(bannerPath(bitmap('##.#', '.##.'))).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 1h2v1h-2z');
  });

  it('is empty for a bitmap with no lit pixel', () => {
    expect(bannerPath(bitmap('...', '...'))).toBe('');
  });
});

describe('bannerScale', () => {
  it('scales by whole pixels to about 300 px wide', () => {
    expect(bannerScale(72)).toBe(4);
    expect(bannerScale(60)).toBe(5);
    expect(bannerScale(130)).toBe(2);
    expect(bannerScale(400)).toBe(1);
  });

  it('never blows a short title up more than five times', () => {
    expect(bannerScale(14)).toBe(5);
    expect(bannerScale(1)).toBe(5);
  });
});

describe('bannerLabel', () => {
  it('spells styled letters as plain ones', () => {
    expect(bannerLabel(TITLE)).toBe('Lil’Horse');
    expect(bannerLabel("Lil'Horse")).toBe("Lil'Horse");
  });
});

describe('the banner font', () => {
  it('covers the title, plain Latin and nothing outside its subset', () => {
    const covers = fontCoverage(readFileSync(BANNER_FONT));
    for (const char of `${TITLE} Lil'Horse — ″`)
      expect(covers.has(char.codePointAt(0) ?? 0)).toBe(true);
    for (const char of '小🍻▀\n') expect(covers.has(char.codePointAt(0) ?? 0)).toBe(false);
  });

  it('draws today’s title in about 70 by 16 pixels', () => {
    const warn = vi.fn();
    const banner = bannerBitmap(TITLE, warn);
    expect(banner.width).toBeGreaterThanOrEqual(60);
    expect(banner.width).toBeLessThanOrEqual(80);
    expect(banner.height).toBeGreaterThanOrEqual(12);
    expect(banner.height).toBeLessThanOrEqual(16);
    expect(warn).not.toHaveBeenCalled();
  });

  it('draws a plain Latin title too', () => {
    const banner = bannerBitmap("Lil'Horse", vi.fn());
    expect(banner.width).toBeGreaterThan(40);
    expect(banner.height).toBeGreaterThan(8);
    expect(banner.pixels.some((pixel) => pixel === 1)).toBe(true);
  });

  it('leaves out the characters the font lacks, with one warning', () => {
    const warn = vi.fn();
    const banner = bannerBitmap('Lil小马Horse🐴', warn);
    expect(banner).toEqual(bannerBitmap('LilHorse', vi.fn()));
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'The banner font has no glyph for 小 (U+5C0F), 马 (U+9A6C), 🐴 (U+1F434) in the masthead title "Lil小马Horse🐴"; the banner leaves them out',
    );
  });

  it('is empty when the font has none of the characters', () => {
    const warn = vi.fn();
    expect(bannerBitmap('小马', warn)).toEqual({ width: 0, height: 0, pixels: new Uint8Array() });
    expect(warn).toHaveBeenCalledOnce();
  });
});
