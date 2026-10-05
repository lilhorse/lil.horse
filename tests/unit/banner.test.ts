import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_FONT,
  bannerBitmap,
  bannerLabel,
  bannerPath,
  fontCoverage,
  halfBlocks,
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

describe('halfBlocks', () => {
  it('puts two pixel rows in one text row', () => {
    expect(halfBlocks(bitmap('##..', '#.#.'))).toEqual(['█▀▄']);
  });

  it('pairs the last row of an odd height with a dark row', () => {
    expect(halfBlocks(bitmap('#.', '##', '.#'))).toEqual(['█▄', ' ▀']);
  });

  it('keeps leading spaces and strips trailing ones', () => {
    expect(halfBlocks(bitmap('.#..', '.#..', '...#', '....'))).toEqual([' █', '   ▀']);
  });

  it('draws nothing for an empty bitmap', () => {
    expect(halfBlocks(bitmap())).toEqual([]);
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

  it('draws the title in 7 or 8 rows of at most 80 half blocks', () => {
    const warn = vi.fn();
    const art = halfBlocks(bannerBitmap(TITLE, warn));
    expect(art.length).toBeGreaterThanOrEqual(7);
    expect(art.length).toBeLessThanOrEqual(8);
    expect(Math.max(...art.map((line) => [...line].length))).toBeLessThanOrEqual(80);
    expect(art.join('')).toMatch(/^[ ▀▄█]+$/);
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
