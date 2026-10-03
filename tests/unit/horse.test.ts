import { describe, expect, it } from 'vitest';
import {
  GRID_16,
  GRID_24,
  PALETTES,
  horsePixels,
  horseRgba,
  horseSvg,
  mix,
} from '../../brand/horse';

function colorAt(pixels: { x: number; y: number; color: string }[], x: number, y: number) {
  return pixels.find((pixel) => pixel.x === x && pixel.y === y)?.color;
}

describe('pixel horse grids', () => {
  it.each([GRID_24, GRID_16])('is a square of known pixel kinds ($size)', (grid) => {
    expect(grid.rows).toHaveLength(grid.size);
    for (const row of grid.rows) expect(row).toMatch(new RegExp(`^[.BMNGg]{${grid.size}}$`));
    expect(grid.rows.join('').match(/g/g)).toHaveLength(1);
  });
});

describe('horsePixels', () => {
  it('mixes channels in sRGB and rounds', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#7aa2f7', '#bb9af7', 0)).toBe('#7aa2f7');
  });

  it('colours the 24 x 24 night horse by the appendix A rules', () => {
    const { pixels } = horsePixels(GRID_24, PALETTES.night);
    expect(colorAt(pixels, 10, 1)).toBe('#b4c9fa');
    expect(colorAt(pixels, 12, 12)).toBe('#9c9ef7');
    expect(colorAt(pixels, 8, 10)).toBe('#5c6195');
    expect(colorAt(pixels, 0, 11)).toBe('#fca7c1');
    expect(colorAt(pixels, 4, 11)).toBe('#fb7aa1');
    expect(colorAt(pixels, 7, 11)).toBe('#a95672');
    expect(colorAt(pixels, 20, 15)).toBe('#4f4c75');
  });

  it('colours the chestnut palette with its own highlight and shade strengths', () => {
    const { pixels } = horsePixels(GRID_24, PALETTES.chestnut);
    expect(colorAt(pixels, 10, 1)).toBe('#e8b691');
    expect(colorAt(pixels, 12, 12)).toBe('#c27748');
    expect(colorAt(pixels, 8, 10)).toBe('#805339');
    expect(colorAt(pixels, 0, 11)).toBe('#755f54');
    expect(colorAt(pixels, 7, 11)).toBe('#36221b');
  });

  it('paints the frame row, the lens row and a white glint over the lens', () => {
    const { pixels, glint } = horsePixels(GRID_24, PALETTES.night);
    for (const x of [10, 11, 12, 13, 14, 16, 17]) expect(colorAt(pixels, x, 8)).toBe('#2a2b3d');
    for (const x of [14, 15, 16, 17]) expect(colorAt(pixels, x, 9)).toBe('#0b0b10');
    expect(colorAt(pixels, 15, 8)).toBe('#2a2b3d');
    expect(glint).toEqual([{ x: 15, y: 8, color: '#ffffff' }]);
  });

  it('gives every filled cell exactly one base pixel', () => {
    for (const grid of [GRID_24, GRID_16]) {
      const { pixels } = horsePixels(grid, PALETTES.night);
      expect(pixels).toHaveLength(grid.rows.join('').replace(/\./g, '').length);
    }
  });
});

describe('horseSvg', () => {
  it('draws crisp merged runs and a separate glint path', () => {
    const svg = horseSvg(GRID_24, PALETTES.night);
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">/,
    );
    expect(svg).toContain('<path class="horse-glint" fill="#ffffff" d="M15 8h1v1h-1z"/>');
    expect(svg).toContain('<path fill="#2a2b3d" d="M10 8h8v1h-8z"/>');
    expect(svg.match(/<path class="horse-glint"/g)).toHaveLength(1);
  });

  it('covers exactly the filled cells', () => {
    const svg = horseSvg(GRID_16, PALETTES.chestnut).replace(/<path class="horse-glint"[^>]*>/, '');
    let area = 0;
    for (const match of svg.matchAll(/h(\d+)v1h-\1z/g)) area += Number(match[1]);
    expect(area).toBe(GRID_16.rows.join('').replace(/\./g, '').length);
  });
});

describe('horseRgba', () => {
  it('centres the sprite at an integer scale on a solid background', () => {
    const rgba = horseRgba(GRID_24, PALETTES.night, {
      canvas: 180,
      scale: 6,
      background: '#1a1b26',
    });
    expect(rgba).toHaveLength(180 * 180 * 4);
    expect([...rgba.subarray(0, 4)]).toEqual([0x1a, 0x1b, 0x26, 255]);
    const at = (x: number, y: number) => [
      ...rgba.subarray((y * 180 + x) * 4, (y * 180 + x) * 4 + 4),
    ];
    expect(at(18 + 15 * 6, 18 + 8 * 6)).toEqual([255, 255, 255, 255]);
  });

  it('leaves the background transparent when none is given', () => {
    const rgba = horseRgba(GRID_16, PALETTES.night, { canvas: 16, scale: 1 });
    expect(rgba[3]).toBe(0);
  });

  it('refuses a canvas the sprite cannot be centred on', () => {
    expect(() => horseRgba(GRID_24, PALETTES.night, { canvas: 25, scale: 1 })).toThrow(
      'cannot be centred',
    );
  });

  it.each([1.25, 1.5, 0.5, 0, -1])('refuses a scale of %s', (scale) => {
    const draw = () => horseRgba(GRID_24, PALETTES.night, { canvas: 48, scale });
    expect(draw).toThrow(RangeError);
    expect(draw).toThrow(/positive integer/);
  });
});
