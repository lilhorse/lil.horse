import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { escapeHtml } from './html';

/** One byte per pixel, row by row from the top left: 1 is lit. */
export interface Bitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// Read from the source tree, not imported, so the font never reaches dist/.
export const BANNER_FONT = join(process.cwd(), 'src/assets/fonts/stix-two-math-subset.otf');
const FAMILY = 'STIX Two Math';
const SIZE = 16;
const ALPHA_THRESHOLD = 128;
const EMPTY: Bitmap = { width: 0, height: 0, pixels: new Uint8Array() };
// The standalone banners: bitmap pixels of margin for the glow, and screen pixels per bitmap pixel.
const IMAGE_PADDING = 3;
const IMAGE_SCALE = 4;

/** The theme colours a standalone banner needs, copied from src/styles/tokens.css. */
export const BANNER_COLORS = {
  light: {
    swatches: ['#c92a2a', '#a35530', '#ffe27a', '#2f7a2f', '#1f4fd6', '#ffc2d9'],
    text: '#1f1b16',
  },
  dark: {
    swatches: ['#f7768e', '#e0af68', '#9ece6a', '#7dcfff', '#7aa2f7', '#bb9af7'],
    text: '#c0caf5',
  },
} as const;

export type BannerTheme = keyof typeof BANNER_COLORS;

/** The code points that a font's Unicode cmap subtables (formats 4 and 12) map to a glyph; it reads nothing past the file's end. */
export function fontCoverage(font: Uint8Array): Set<number> {
  const data = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const fits = (at: number, bytes: number) => at >= 0 && at + bytes <= data.byteLength;
  const covered = new Set<number>();

  const format4 = (at: number) => {
    if (!fits(at, 14)) return;
    const segments = Math.floor(data.getUint16(at + 6) / 2);
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    if (!fits(rangeOffsets, segments * 2)) return;
    for (let segment = 0; segment < segments; segment++) {
      const start = data.getUint16(starts + segment * 2);
      const end = data.getUint16(ends + segment * 2);
      const delta = data.getUint16(deltas + segment * 2);
      const rangeOffset = data.getUint16(rangeOffsets + segment * 2);
      for (let code = start; code <= end && code !== 0xffff; code++) {
        let glyph = (code + delta) & 0xffff;
        if (rangeOffset !== 0) {
          const index = rangeOffsets + segment * 2 + rangeOffset + (code - start) * 2;
          if (!fits(index, 2)) break;
          const id = data.getUint16(index);
          glyph = id === 0 ? 0 : (id + delta) & 0xffff;
        }
        if (glyph !== 0) covered.add(code);
      }
    }
  };

  const format12 = (at: number) => {
    if (!fits(at, 16)) return;
    const groups = data.getUint32(at + 12);
    for (let group = 0; group < groups; group++) {
      const record = at + 16 + group * 12;
      if (!fits(record, 12)) return;
      const start = data.getUint32(record);
      const end = data.getUint32(record + 4);
      const glyph = data.getUint32(record + 8);
      if (end > 0x10ffff) continue;
      for (let code = start; code <= end; code++) if (glyph + code - start !== 0) covered.add(code);
    }
  };

  const tables = fits(4, 2) ? data.getUint16(4) : 0;
  for (let table = 0; table < tables && fits(12 + table * 16, 16); table++) {
    const record = 12 + table * 16;
    if (String.fromCharCode(...font.subarray(record, record + 4)) !== 'cmap') continue;
    const cmap = data.getUint32(record + 8);
    const subtables = fits(cmap, 4) ? data.getUint16(cmap + 2) : 0;
    for (let subtable = 0; subtable < subtables && fits(cmap + 4 + subtable * 8, 8); subtable++) {
      const entry = cmap + 4 + subtable * 8;
      const platform = data.getUint16(entry);
      const encoding = data.getUint16(entry + 2);
      // Windows encoding 0 is a symbol font's private-use codes, not Unicode text.
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const at = cmap + data.getUint32(entry + 4);
      if (!fits(at, 2)) continue;
      if (data.getUint16(at) === 4) format4(at);
      if (data.getUint16(at) === 12) format12(at);
    }
  }
  return covered;
}

function crop(rgba: Uint8Array, width: number, height: number): Bitmap {
  const lit = (x: number, y: number) => (rgba[(y * width + x) * 4 + 3] ?? 0) >= ALPHA_THRESHOLD;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!lit(x, y)) continue;
      [left, top] = [Math.min(left, x), Math.min(top, y)];
      [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
    }
  }
  if (right < 0) return EMPTY;
  const bitmap = { width: right - left + 1, height: bottom - top + 1 };
  const pixels = new Uint8Array(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y++)
    for (let x = 0; x < bitmap.width; x++)
      pixels[y * bitmap.width + x] = lit(left + x, top + y) ? 1 : 0;
  return { ...bitmap, pixels };
}

function rasterize(text: string): Bitmap {
  const width = SIZE * 2 * (Array.from(text).length + 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SIZE * 4}"><text x="${SIZE}" y="${SIZE * 2.5}" font-family="${FAMILY}" font-size="${SIZE}">${escapeHtml(text)}</text></svg>`;
  const image = new Resvg(svg, {
    font: { fontFiles: [BANNER_FONT], loadSystemFonts: false, defaultFontFamily: FAMILY },
  }).render();
  return crop(image.pixels, image.width, image.height);
}

const codePoint = (char: string) => char.codePointAt(0) ?? 0;
const describe = (char: string) =>
  `${char} (U+${codePoint(char).toString(16).toUpperCase().padStart(4, '0')})`;

let coverage: Set<number> | undefined;
const drawn = new Map<string, Bitmap>();

/** The title in the banner font at 16 px, cropped to its ink; warns once per title about characters the font lacks. */
export function bannerBitmap(title: string, warn: (message: string) => void): Bitmap {
  const known = drawn.get(title);
  if (known) return known;
  coverage ??= fontCoverage(readFileSync(BANNER_FONT));
  const covered = coverage;
  const chars = Array.from(title);
  const missing = [...new Set(chars.filter((char) => !covered.has(codePoint(char))))];
  if (missing.length > 0)
    warn(
      `The banner font has no glyph for ${missing.map(describe).join(', ')} in the masthead title ${JSON.stringify(title)}; the banner leaves them out`,
    );
  const kept = chars.filter((char) => covered.has(codePoint(char))).join('');
  const bitmap = kept.trim() ? rasterize(kept) : EMPTY;
  drawn.set(title, bitmap);
  return bitmap;
}

/** SVG path data with one rectangle per run of lit pixels in a row. */
export function bannerPath(bitmap: Bitmap): string {
  const lit = (x: number, y: number) => bitmap.pixels[y * bitmap.width + x] === 1;
  let d = '';
  for (let y = 0; y < bitmap.height; y++) {
    let x = 0;
    while (x < bitmap.width) {
      let run = 0;
      while (x + run < bitmap.width && lit(x + run, y)) run += 1;
      if (run > 0) d += `M${x} ${y}h${run}v1h-${run}z`;
      x += Math.max(run, 1);
    }
  }
  return d;
}

/** Screen pixels per bitmap pixel on the home page: whole, close to 300 px wide, at most 5. */
export function bannerScale(width: number): number {
  return Math.min(5, Math.max(1, Math.round(300 / Math.max(width, 1))));
}

/** The title as a screen reader should say it: styled letters such as 𝕷 become plain ones. */
export function bannerLabel(title: string): string {
  // Control characters, U+FFFE, U+FFFF and lone surrogates would make the standalone SVG invalid XML.
  return title.normalize('NFKC').replace(/[\p{Cc}\p{Cs}\uFFFE\uFFFF]/gu, '');
}

/** The size of a standalone banner in screen pixels. */
export function bannerImageSize(bitmap: Pick<Bitmap, 'width' | 'height'>): {
  width: number;
  height: number;
} {
  return {
    width: (bitmap.width + IMAGE_PADDING * 2) * IMAGE_SCALE,
    height: (bitmap.height + IMAGE_PADDING * 2) * IMAGE_SCALE,
  };
}

// The site's 1 px and 6 px drop-shadow() blurs at 4×; CSS takes a blur length as the standard deviation.
const GLOWS: Record<BannerTheme, (color: (typeof BANNER_COLORS)[BannerTheme]) => string> = {
  dark: ({ swatches }) =>
    `<feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${swatches[5]}" flood-opacity="0.45"/>`,
  light: ({ text }) =>
    `<feDropShadow dx="0" dy="0" stdDeviation="0.25" flood-color="${text}" flood-opacity="0.45"/>` +
    `<feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${text}" flood-opacity="0.22"/>`,
};

const SHIMMER_OPACITY: Record<BannerTheme, number> = { dark: 0.75, light: 0.6 };

/** The width of the shimmer's band of light, in bitmap pixels. */
export function shimmerBand(width: number): number {
  return Math.max(4, Math.round(width / 4));
}

/** The banner as a file of its own, in one theme's colours, for pages that cannot use the site's CSS. */
export function bannerSvg(bitmap: Bitmap, title: string, theme: BannerTheme): string {
  const { width, height } = bannerImageSize(bitmap);
  const [x, y, w, h] = [-IMAGE_PADDING, -IMAGE_PADDING, width / IMAGE_SCALE, height / IMAGE_SCALE];
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${width}" height="${height}" shape-rendering="crispEdges"><title>${escapeHtml(bannerLabel(title))}</title>`;
  if (bitmap.width === 0) return `${open}</svg>\n`;
  const colors = BANNER_COLORS[theme];
  const stops = colors.swatches
    .map((color, index) => `<stop offset="${index * 20}%" stop-color="${color}"/>`)
    .join('');
  const band = shimmerBand(bitmap.width);
  const shine = (opacity: number) =>
    `<stop offset="0.3" stop-color="#fff" stop-opacity="${+(opacity / 3).toFixed(3)}"/>` +
    `<stop offset="0.5" stop-color="#fff" stop-opacity="${opacity}"/>` +
    `<stop offset="0.7" stop-color="#fff" stop-opacity="${+(opacity / 3).toFixed(3)}"/>`;
  return (
    open +
    // A 1.6 s sweep every 3 s; the band waits off the letters between sweeps.
    `<style>.shine{animation:shine 3s ease-in-out infinite}@keyframes shine{53.33%,100%{transform:translateX(${bitmap.width + band}px)}}@media (prefers-reduced-motion:reduce){.shine{display:none}}</style>` +
    `<defs><path id="letters" d="${bannerPath(bitmap)}"/>` +
    `<linearGradient id="swatches" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${bitmap.width}" y2="0">${stops}</linearGradient>` +
    `<linearGradient id="band"><stop offset="0" stop-color="#fff" stop-opacity="0"/>${shine(SHIMMER_OPACITY[theme])}<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    '<clipPath id="ink"><use href="#letters"/></clipPath>' +
    // CSS filters blend in sRGB; SVG filters default to linearRGB, which would lighten the glow.
    `<filter id="glow" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" color-interpolation-filters="sRGB">${GLOWS[theme](colors)}</filter>` +
    '</defs><use href="#letters" fill="url(#swatches)" filter="url(#glow)"/>' +
    `<g clip-path="url(#ink)"><rect class="shine" x="${-band}" y="${y}" width="${band}" height="${h}" fill="url(#band)"/></g></svg>\n`
  );
}
