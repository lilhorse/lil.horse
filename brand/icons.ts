import sharp from 'sharp';
import { GRID_16, GRID_24, PALETTES, horsePaths, horseRgba, horseSvg } from './horse';

export const ICON_BACKGROUND = '#1a1b26';

export async function pngFromRgba(rgba: Buffer, size: number): Promise<Buffer> {
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An ICO container holding PNG images, which every browser since IE 11 reads. */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

export function faviconSvg(): string {
  const style =
    '.dark{display:none}@media (prefers-color-scheme:dark){.light{display:none}.dark{display:inline}}';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_16.size} ${GRID_16.size}" shape-rendering="crispEdges">`,
    `<style>${style}</style>`,
    `<g class="light">${horsePaths(GRID_16, PALETTES.chestnut)}</g>`,
    `<g class="dark">${horsePaths(GRID_16, PALETTES.night)}</g>`,
    '</svg>',
    '',
  ].join('\n');
}

export function webManifest(): string {
  const manifest = {
    name: "Lil'Horse",
    short_name: "Lil'Horse",
    start_url: '/',
    display: 'standalone',
    background_color: ICON_BACKGROUND,
    theme_color: ICON_BACKGROUND,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function square(
  grid: typeof GRID_24,
  canvas: number,
  scale: number,
  background?: string,
): Promise<Buffer> {
  return pngFromRgba(horseRgba(grid, PALETTES.night, { canvas, scale, background }), canvas);
}

/** Every generated brand file, keyed by its path from the project root. */
export async function brandFiles(): Promise<Map<string, Buffer | string>> {
  const files = new Map<string, Buffer | string>();
  files.set('src/assets/brand/horse-night.svg', `${horseSvg(GRID_24, PALETTES.night)}\n`);
  files.set('src/assets/brand/horse-chestnut.svg', `${horseSvg(GRID_24, PALETTES.chestnut)}\n`);
  files.set('src/assets/brand/horse-night-16.svg', `${horseSvg(GRID_16, PALETTES.night)}\n`);
  files.set('src/assets/brand/horse-chestnut-16.svg', `${horseSvg(GRID_16, PALETTES.chestnut)}\n`);
  files.set('public/favicon.svg', faviconSvg());
  files.set(
    'public/favicon.ico',
    encodeIco([
      { size: 16, png: await square(GRID_16, 16, 1) },
      { size: 32, png: await square(GRID_24, 32, 1) },
      { size: 48, png: await square(GRID_24, 48, 2) },
    ]),
  );
  files.set('public/apple-touch-icon.png', await square(GRID_24, 180, 6, ICON_BACKGROUND));
  files.set('public/icons/icon-192.png', await square(GRID_24, 192, 6, ICON_BACKGROUND));
  files.set('public/icons/icon-512.png', await square(GRID_24, 512, 16, ICON_BACKGROUND));
  files.set('public/icons/icon-maskable-512.png', await square(GRID_24, 512, 12, ICON_BACKGROUND));
  files.set('public/site.webmanifest', webManifest());
  return files;
}
