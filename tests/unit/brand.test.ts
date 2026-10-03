import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { brandFiles, encodeIco, faviconSvg, webManifest } from '../../brand/icons';

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function icoImages(ico: Buffer) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const size = ico.readUInt8(entry) || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return { size, png: ico.subarray(offset, offset + length) };
  });
}

describe('encodeIco', () => {
  it('writes an icon directory followed by the PNG images', () => {
    const ico = encodeIco([
      { size: 16, png: Buffer.from('aa') },
      { size: 32, png: Buffer.from('bbb') },
    ]);
    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
    expect(icoImages(ico)).toEqual([
      { size: 16, png: Buffer.from('aa') },
      { size: 32, png: Buffer.from('bbb') },
    ]);
  });
});

describe('faviconSvg', () => {
  it('holds a light and a dark sprite switched by the colour scheme', () => {
    const svg = faviconSvg();
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('@media (prefers-color-scheme:dark)');
    expect(svg.match(/<g class="(light|dark)">/g)).toEqual([
      '<g class="light">',
      '<g class="dark">',
    ]);
  });
});

describe('webManifest', () => {
  it('names the site and lists the app icons', () => {
    const manifest = JSON.parse(webManifest()) as {
      name: string;
      icons: { src: string; purpose?: string }[];
    };
    expect(manifest.name).toBe("Lil'Horse");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
    ]);
    expect(manifest.icons[2]?.purpose).toBe('maskable');
  });
});

describe('brandFiles', () => {
  it('renders every icon at its declared size', async () => {
    const files = await brandFiles();
    const sizes: Record<string, number> = {
      'public/apple-touch-icon.png': 180,
      'public/icons/icon-192.png': 192,
      'public/icons/icon-512.png': 512,
      'public/icons/icon-maskable-512.png': 512,
    };
    for (const [path, size] of Object.entries(sizes)) {
      const image = await pixels(files.get(path) as Buffer);
      expect([image.width, image.height]).toEqual([size, size]);
    }
    const ico = icoImages(files.get('public/favicon.ico') as Buffer);
    expect(ico.map((image) => image.size)).toEqual([16, 32, 48]);
    for (const image of ico) expect((await pixels(image.png)).width).toBe(image.size);
  });

  it('matches the committed files (run pnpm brand after changing brand/)', async () => {
    for (const [path, contents] of await brandFiles()) {
      const committed = readFileSync(path);
      if (typeof contents === 'string') expect(committed.toString('utf8'), path).toBe(contents);
      else if (path.endsWith('.ico')) {
        const [fresh, saved] = [icoImages(contents), icoImages(committed)];
        expect(
          saved.map((image) => image.size),
          path,
        ).toEqual(fresh.map((image) => image.size));
        for (const [index, image] of fresh.entries())
          expect((await pixels(saved[index]?.png as Buffer)).data, path).toEqual(
            (await pixels(image.png)).data,
          );
      } else expect((await pixels(committed)).data, path).toEqual((await pixels(contents)).data);
    }
  });
});
