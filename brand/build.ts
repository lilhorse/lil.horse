import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { GRID_16, GRID_24, PALETTES, horseRgba } from './horse';
import { brandFiles, pngFromRgba } from './icons';

const files = await brandFiles();
for (const [path, contents] of files) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
console.log(`Wrote ${files.size} brand files`);

if (process.argv.includes('--preview')) {
  const out = 'test-results/brand';
  await mkdir(out, { recursive: true });
  for (const grid of [GRID_24, GRID_16]) {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const [background, label] of [
        ['#1a1b26', 'on-dark'],
        ['#f2f4f7', 'on-light'],
      ] as const) {
        const scale = grid.size === 24 ? 10 : 15;
        const canvas = grid.size * scale + 40;
        const big = horseRgba(grid, palette, { canvas, scale, background });
        await writeFile(
          join(out, `${name}-${grid.size}-${label}.png`),
          await pngFromRgba(big, canvas),
        );
      }
      for (const scale of [1, 2]) {
        const actual = horseRgba(grid, palette, { canvas: grid.size * scale, scale });
        await writeFile(
          join(out, `${name}-${grid.size}-actual-${scale}x.png`),
          await sharp(await pngFromRgba(actual, grid.size * scale))
            .png()
            .toBuffer(),
        );
      }
    }
  }
  console.log(`Wrote previews to ${out}`);
}
