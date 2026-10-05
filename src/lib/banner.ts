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
// Indexed by top * 2 + bottom.
const HALF_BLOCKS = [' ', '▄', '▀', '█'];

function addFormat4(data: DataView, at: number, covered: Set<number>): void {
  const segments = data.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment++) {
    const start = data.getUint16(starts + segment * 2);
    const end = data.getUint16(ends + segment * 2);
    const delta = data.getUint16(deltas + segment * 2);
    const rangeOffset = data.getUint16(rangeOffsets + segment * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph = (code + delta) & 0xffff;
      if (rangeOffset !== 0) {
        const index = data.getUint16(rangeOffsets + segment * 2 + rangeOffset + (code - start) * 2);
        glyph = index === 0 ? 0 : (index + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(code);
    }
  }
}

function addFormat12(data: DataView, at: number, covered: Set<number>): void {
  const groups = data.getUint32(at + 12);
  for (let group = 0; group < groups; group++) {
    const record = at + 16 + group * 12;
    const start = data.getUint32(record);
    const end = data.getUint32(record + 4);
    const glyph = data.getUint32(record + 8);
    for (let code = start; code <= end; code++) if (glyph + code - start !== 0) covered.add(code);
  }
}

/** The code points that a font's Unicode cmap subtables (formats 4 and 12) map to a glyph. */
export function fontCoverage(font: Uint8Array): Set<number> {
  const data = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const covered = new Set<number>();
  for (let table = 0; table < data.getUint16(4); table++) {
    const record = 12 + table * 16;
    if (String.fromCharCode(...font.subarray(record, record + 4)) !== 'cmap') continue;
    const cmap = data.getUint32(record + 8);
    for (let subtable = 0; subtable < data.getUint16(cmap + 2); subtable++) {
      const platform = data.getUint16(cmap + 4 + subtable * 8);
      const at = cmap + data.getUint32(cmap + 8 + subtable * 8);
      if (platform !== 0 && platform !== 3) continue;
      if (data.getUint16(at) === 4) addFormat4(data, at, covered);
      if (data.getUint16(at) === 12) addFormat12(data, at, covered);
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

/** Two pixel rows per line of text, without trailing spaces. */
export function halfBlocks(bitmap: Bitmap): string[] {
  const at = (x: number, y: number) =>
    y < bitmap.height ? (bitmap.pixels[y * bitmap.width + x] ?? 0) : 0;
  const lines: string[] = [];
  for (let y = 0; y < bitmap.height; y += 2) {
    let line = '';
    for (let x = 0; x < bitmap.width; x++) line += HALF_BLOCKS[at(x, y) * 2 + at(x, y + 1)];
    lines.push(line.trimEnd());
  }
  return lines;
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

/** The title as a screen reader should say it: styled letters such as 𝕷 become plain ones. */
export function bannerLabel(title: string): string {
  return title.normalize('NFKC');
}
