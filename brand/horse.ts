export interface HorseGrid {
  size: number;
  rows: readonly string[];
  /** Body pixels on the right edge of the head take the highlight only above this row. */
  edgeHighlightRows: number;
}

export interface Palette {
  b0: string;
  b1: string;
  m0: string;
  m1: string;
  hi: number;
  lo: number;
}

export interface Pixel {
  x: number;
  y: number;
  color: string;
}

export const GRID_24: HorseGrid = {
  size: 24,
  edgeHighlightRows: 14,
  rows: [
    '........................',
    '..........B...B.........',
    '..........BB.BB.........',
    '.........MBBBBB.........',
    '........MMBBBBBB........',
    '.......MMMMBBBBBB.......',
    '.....MMMMMBBBBBBBB......',
    '.....MMMMMBBBBBBBB......',
    '..MMMMMMMBGGGGGgGGB.....',
    '...MMMMMMBBBBBGGGGB.....',
    '....MMMMBBBBBBBBBBBB....',
    'MMMMMMMMBBBBBBBBBBBBB...',
    '..MMMMMBBBBBBBBBBBBBB...',
    '..MMMMMBBBBBBBBBBBBBBB..',
    '...MMMBBBBBB...BBBBBBB..',
    'MMMMMMBBBBB.....BBBBNBB.',
    '.MMMMMBBBBB......BBBBBB.',
    '..MMMMBBBBB.......BBNNB.',
    '..MMMBBBBBB.......BBBBB.',
    '..MMMBBBBBB.............',
    'MMMMMBBBBBB.............',
    '.MMMMBBBBBBB............',
    '..MMMBBBBBBB............',
    '...MMBBBBBBB............',
  ],
};

export const GRID_16: HorseGrid = {
  size: 16,
  edgeHighlightRows: 9,
  rows: [
    '................',
    '.......B.B......',
    '......MBBB......',
    '.....MMBBBB.....',
    '...MMMMBBBBB....',
    '.MMMMMBGGGgGB...',
    '..MMMMBBBBGGB...',
    'MMMMMBBBBBBBBB..',
    '.MMMMBBBBBBBBB..',
    '..MMMBBB..BBBBB.',
    'MMMMBBB....BBNB.',
    '.MMMBBB.....BBB.',
    '.MMBBBB.........',
    'MMMBBBB.........',
    '.MMBBBBB........',
    '..MBBBBB........',
  ],
};

export const PALETTES = {
  night: { b0: '#7aa2f7', b1: '#bb9af7', m0: '#ff7eb3', m1: '#f7768e', hi: 0.42, lo: 0.45 },
  chestnut: { b0: '#e0975f', b1: '#a65a32', m0: '#5a3522', m1: '#2e1a10', hi: 0.32, lo: 0.4 },
} as const satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

const WHITE = '#ffffff';
const SHADE = '#16161e';
const FRAME = '#2a2b3d';
const LENS = '#0b0b10';

function channels(hex: string): number[] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

export function mix(a: string, b: string, t: number): string {
  const from = channels(a);
  const to = channels(b);
  return `#${from
    .map((value, index) =>
      Math.round(value * (1 - t) + (to[index] ?? 0) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function cell(grid: HorseGrid, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return '.';
  return grid.rows[y]?.[x] ?? '.';
}

function lensColor(grid: HorseGrid, x: number, y: number): string {
  const above = cell(grid, x, y - 1);
  return above === 'G' || above === 'g' ? LENS : FRAME;
}

/** Each glint pixel covers a base pixel in `pixels`, so draw `glint` last. */
export function horsePixels(
  grid: HorseGrid,
  palette: Palette,
): { pixels: Pixel[]; glint: Pixel[] } {
  const pixels: Pixel[] = [];
  const glint: Pixel[] = [];
  const filled = (x: number, y: number) => cell(grid, x, y) !== '.';
  for (let y = 0; y < grid.size; y++) {
    const t = y / (grid.size - 1);
    const body = mix(palette.b0, palette.b1, t);
    const mane = mix(palette.m0, palette.m1, t);
    for (let x = 0; x < grid.size; x++) {
      const kind = cell(grid, x, y);
      let color: string;
      switch (kind) {
        case 'B':
          if (
            !filled(x, y - 1) ||
            !filled(x + 1, y - 1) ||
            (!filled(x + 1, y) && y < grid.edgeHighlightRows)
          )
            color = mix(body, WHITE, palette.hi);
          else if (!filled(x, y + 1) || cell(grid, x - 1, y) === 'M')
            color = mix(body, SHADE, palette.lo);
          else color = body;
          break;
        case 'M':
          if (!filled(x - 1, y) || !filled(x, y - 1)) color = mix(mane, WHITE, palette.hi * 0.8);
          else if ('BGgN'.includes(cell(grid, x + 1, y)))
            color = mix(mane, SHADE, palette.lo * 0.8);
          else color = mane;
          break;
        case 'N':
          color = mix(body, SHADE, 0.6);
          break;
        case 'G':
          color = lensColor(grid, x, y);
          break;
        case 'g':
          pixels.push({ x, y, color: lensColor(grid, x, y) });
          glint.push({ x, y, color: WHITE });
          continue;
        default:
          continue;
      }
      pixels.push({ x, y, color });
    }
  }
  return { pixels, glint };
}

function runs(pixels: Pixel[]): string {
  const sorted = [...pixels].sort((a, b) => a.y - b.y || a.x - b.x);
  let d = '';
  for (let index = 0; index < sorted.length;) {
    const start = sorted[index];
    if (!start) break;
    let length = 1;
    while (sorted[index + length]?.y === start.y && sorted[index + length]?.x === start.x + length)
      length += 1;
    d += `M${start.x} ${start.y}h${length}v1h-${length}z`;
    index += length;
  }
  return d;
}

function paths(pixels: Pixel[], className?: string): string {
  const byColor = new Map<string, Pixel[]>();
  for (const pixel of pixels)
    byColor.set(pixel.color, [...(byColor.get(pixel.color) ?? []), pixel]);
  const attribute = className ? ` class="${className}"` : '';
  return [...byColor]
    .map(([color, group]) => `<path${attribute} fill="${color}" d="${runs(group)}"/>`)
    .join('');
}

/** The sprite as SVG paths without the outer element, for files that hold more than one palette. */
export function horsePaths(grid: HorseGrid, palette: Palette): string {
  const { pixels, glint } = horsePixels(grid, palette);
  return paths(pixels) + paths(glint, 'horse-glint');
}

export function horseSvg(grid: HorseGrid, palette: Palette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.size} ${grid.size}" shape-rendering="crispEdges">${horsePaths(grid, palette)}</svg>`;
}

/** Draws the sprite at an integer scale, centred on a square RGBA canvas. */
export function horseRgba(
  grid: HorseGrid,
  palette: Palette,
  options: { canvas: number; scale: number; background?: string },
): Buffer {
  const { canvas, scale, background } = options;
  const offset = (canvas - grid.size * scale) / 2;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`A ${grid.size}px grid at ${scale}x cannot be centred on a ${canvas}px canvas`);
  const buffer = Buffer.alloc(canvas * canvas * 4);
  if (background) {
    const [r = 0, g = 0, b = 0] = channels(background);
    for (let index = 0; index < canvas * canvas; index++) buffer.set([r, g, b, 255], index * 4);
  }
  const { pixels, glint } = horsePixels(grid, palette);
  for (const { x, y, color } of [...pixels, ...glint]) {
    const [r = 0, g = 0, b = 0] = channels(color);
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        buffer.set(
          [r, g, b, 255],
          ((offset + y * scale + dy) * canvas + offset + x * scale + dx) * 4,
        );
      }
    }
  }
  return buffer;
}
