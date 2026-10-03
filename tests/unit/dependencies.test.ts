import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  packageManager: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

// TypeScript stays on 6.0 until @astrojs/check and typescript-eslint support 7; @types/node tracks Node 24 patches.
const RANGES: Record<string, string> = { typescript: '~6.0.3', '@types/node': '~24.19.1' };

describe('package.json', () => {
  it('pins the package manager', () => {
    expect(manifest.packageManager).toBe('pnpm@10.33.0');
  });

  it('pins every dependency to an exact version', () => {
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(all).length).toBeGreaterThan(20);
    for (const [name, version] of Object.entries(all)) {
      if (name in RANGES) expect(version, name).toBe(RANGES[name]);
      else expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
