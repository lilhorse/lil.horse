import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { copyKatex, copyMedia } from '../../integrations/static-assets';

async function mediaCache(keys: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'assets-'));
  for (const key of keys) {
    await mkdir(join(root, 'media', key), { recursive: true });
    await writeFile(join(root, 'media', key, 'meta.json'), '{}');
    await writeFile(join(root, 'media', key, '480.webp'), 'x');
  }
  return root;
}

describe('copyMedia', () => {
  it('copies only the manifest entries and leaves meta.json behind', async () => {
    const root = await mediaCache(['k1', 'k2', 'stale']);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(['k1', 'k2']));
    const count = await copyMedia({
      mediaDir: join(root, 'media'),
      manifest: join(root, 'manifest.json'),
      outDir: join(root, 'dist', '_media'),
    });
    expect(count).toBe(2);
    expect(existsSync(join(root, 'dist', '_media', 'k1', '480.webp'))).toBe(true);
    expect(existsSync(join(root, 'dist', '_media', 'k1', 'meta.json'))).toBe(false);
    expect(existsSync(join(root, 'dist', '_media', 'stale'))).toBe(false);
  });

  it('fails when the manifest names media that is not cached', async () => {
    const root = await mediaCache(['k1']);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(['k1', 'gone']));
    await expect(
      copyMedia({
        mediaDir: join(root, 'media'),
        manifest: join(root, 'manifest.json'),
        outDir: join(root, 'out'),
      }),
    ).rejects.toThrow('gone');
  });
});

describe('copyKatex', () => {
  it('copies the stylesheet and fonts under a versioned folder', async () => {
    const out = await mkdtemp(join(tmpdir(), 'katex-'));
    await copyKatex(out);
    expect(existsSync(join(out, katex.version, 'katex.min.css'))).toBe(true);
    expect(
      (await readdir(join(out, katex.version, 'fonts'))).some((file) => file.endsWith('.woff2')),
    ).toBe(true);
  });
});
