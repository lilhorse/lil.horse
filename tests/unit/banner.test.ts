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
  it('draws the dark banner with its swatches, a soft glow and a shimmer, padded for the glow', () => {
    expect(bannerSvg(bitmap('#.', '##'), TITLE, 'dark')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 8 8" width="32" height="32" shape-rendering="crispEdges">' +
        '<title>Lil’Horse</title>' +
        '<style>.shine{animation:shine 3s ease-in-out infinite}@keyframes shine{53.33%,100%{transform:translateX(6px)}}@media (prefers-reduced-motion:reduce){.shine{display:none}}</style>' +
        '<defs><path id="letters" d="M0 0h1v1h-1zM0 1h2v1h-2z"/>' +
        `<linearGradient id="swatches" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="2" y2="0">${GRADIENT(BANNER_COLORS.dark.swatches)}</linearGradient>` +
        '<linearGradient id="band"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.25"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.7" stop-color="#fff" stop-opacity="0.25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
        '<clipPath id="ink"><use href="#letters"/></clipPath>' +
        '<filter id="glow" filterUnits="userSpaceOnUse" x="-3" y="-3" width="8" height="8" color-interpolation-filters="sRGB">' +
        '<feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#bb9af7" flood-opacity="0.45"/></filter></defs>' +
        '<use href="#letters" fill="url(#swatches)" filter="url(#glow)"/>' +
        '<g clip-path="url(#ink)"><rect class="shine" x="-4" y="-3" width="4" height="8" fill="url(#band)"/></g></svg>\n',
    );
  });

  it('sweeps a soft band of light across the letters only, never under reduced motion', () => {
    const banner = bannerBitmap(TITLE, vi.fn());
    const band = Math.round(banner.width / 4);
    for (const [theme, peak, shoulder] of [
      ['dark', 0.75, 0.25],
      ['light', 0.6, 0.2],
    ] as const) {
      const svg = bannerSvg(banner, TITLE, theme);
      expect(svg).toContain('<clipPath id="ink"><use href="#letters"/></clipPath>');
      expect(svg).toContain(
        `<g clip-path="url(#ink)"><rect class="shine" x="${-band}" y="-3" width="${band}"`,
      );
      expect(svg).toContain(
        `<stop offset="0.3" stop-color="#fff" stop-opacity="${shoulder}"/>` +
          `<stop offset="0.5" stop-color="#fff" stop-opacity="${peak}"/>` +
          `<stop offset="0.7" stop-color="#fff" stop-opacity="${shoulder}"/>`,
      );
      expect(svg).toContain('.shine{animation:shine 3s ease-in-out infinite}');
      expect(svg).toContain(
        `@keyframes shine{53.33%,100%{transform:translateX(${banner.width + band}px)}}`,
      );
      expect(svg).toContain('@media (prefers-reduced-motion:reduce){.shine{display:none}}');
      expect(svg.length).toBeLessThan(3_100);
    }
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

  it('leaves control characters out of that title, so the file stays valid XML', () => {
    const svg = bannerSvg(bitmap('#'), 'Lil\u0000’\u0007Horse\u0085\uFFFF\uD800', 'dark');
    expect(svg).toContain('<title>Lil’Horse</title>');
    expect(drawnAlpha(svg).some((alpha) => alpha > 0)).toBe(true);
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

  it('drops control characters, noncharacters and lone surrogates', () => {
    expect(bannerLabel('Lil\tHorse\u0000\u009F\uFFFE\uDFFF 🐴')).toBe('LilHorse 🐴');
  });
});

type Subtable = { platform: number; encoding: number; body: Uint8Array };

/** A font file with only a cmap table, holding the given subtables. */
function sfnt(subtables: Subtable[]): Uint8Array {
  const offsets: number[] = [];
  let length = 4 + subtables.length * 8;
  for (const { body } of subtables) {
    offsets.push(length);
    length += body.length;
  }
  const font = new Uint8Array(28 + length);
  const view = new DataView(font.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  font.set(
    [...'cmap'].map((char) => char.charCodeAt(0)),
    12,
  );
  view.setUint32(20, 28);
  view.setUint32(24, length);
  view.setUint16(30, subtables.length);
  subtables.forEach(({ platform, encoding, body }, index) => {
    view.setUint16(32 + index * 8, platform);
    view.setUint16(34 + index * 8, encoding);
    view.setUint32(36 + index * 8, offsets[index] ?? 0);
    font.set(body, 28 + (offsets[index] ?? 0));
  });
  return font;
}

/** A format 4 subtable mapping each [start, end] range by delta, with the closing 0xFFFF segment. */
function format4(...ranges: [number, number, number][]): Uint8Array {
  const segments = [...ranges, [0xffff, 0xffff, 1] as [number, number, number]];
  const count = segments.length;
  const body = new Uint8Array(16 + count * 8);
  const view = new DataView(body.buffer);
  view.setUint16(0, 4);
  view.setUint16(2, body.length);
  view.setUint16(6, count * 2);
  segments.forEach(([start, end, delta], index) => {
    view.setUint16(14 + index * 2, end);
    view.setUint16(16 + count * 2 + index * 2, start);
    view.setUint16(16 + count * 4 + index * 2, delta & 0xffff);
  });
  return body;
}

/** A format 12 subtable from [start, end, first glyph] groups. */
function format12(...groups: [number, number, number][]): Uint8Array {
  const body = new Uint8Array(16 + groups.length * 12);
  const view = new DataView(body.buffer);
  view.setUint16(0, 12);
  view.setUint32(4, body.length);
  view.setUint32(12, groups.length);
  groups.forEach(([start, end, glyph], index) => {
    view.setUint32(16 + index * 12, start);
    view.setUint32(20 + index * 12, end);
    view.setUint32(24 + index * 12, glyph);
  });
  return body;
}

describe('fontCoverage', () => {
  it('reads Unicode subtables in formats 4 and 12', () => {
    const font = sfnt([
      { platform: 3, encoding: 1, body: format4([0x41, 0x43, 1]) },
      { platform: 3, encoding: 10, body: format12([0x1d400, 0x1d401, 10]) },
      { platform: 0, encoding: 4, body: format12([0x2019, 0x2019, 20]) },
    ]);
    expect([...fontCoverage(font)].sort((a, b) => a - b)).toEqual([
      0x41, 0x42, 0x43, 0x2019, 0x1d400, 0x1d401,
    ]);
  });

  it('skips a format 12 group that ends past U+10FFFF', () => {
    const font = sfnt([
      { platform: 3, encoding: 10, body: format12([0x41, 0x41, 1], [0x10fff0, 0xffffffff, 2]) },
    ]);
    expect([...fontCoverage(font)]).toEqual([0x41]);
  });

  it('ignores symbol and Macintosh subtables', () => {
    const font = sfnt([
      { platform: 3, encoding: 0, body: format4([0xf020, 0xf022, 1]) },
      { platform: 1, encoding: 0, body: format12([0x41, 0x43, 1]) },
    ]);
    expect(fontCoverage(font).size).toBe(0);
  });

  it('reads what lies inside a truncated or lying file and never throws', () => {
    const font = sfnt([{ platform: 3, encoding: 10, body: format12([0x41, 0x5a, 1]) }]);
    for (let length = 0; length <= font.length; length++)
      expect(() => fontCoverage(font.subarray(0, length)), `${length} bytes`).not.toThrow();
    const lying = sfnt([{ platform: 3, encoding: 10, body: format12([0x41, 0x42, 1]) }]);
    new DataView(lying.buffer).setUint32(28 + 12 + 12, 0xffffffff);
    expect([...fontCoverage(lying)]).toEqual([0x41, 0x42]);
    new DataView(lying.buffer).setUint32(36, 0x7fffffff);
    expect(fontCoverage(lying).size).toBe(0);
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
