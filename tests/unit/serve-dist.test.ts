import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDistFile } from '../../scripts/serve-dist';
import { tempDir } from '../helpers/temp-dir';

async function dist(): Promise<string> {
  const root = await tempDir('serve-');
  for (const path of [
    'index.html',
    'blog.html',
    'blog/douban.html',
    '404.html',
    'blog/tags/中文.html',
    '_media/k/480.webp',
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), path);
  }
  return root;
}

describe('resolveDistFile', () => {
  it('serves pages without .html and assets as they are', async () => {
    const root = await dist();
    expect(resolveDistFile(root, '/')).toEqual({ file: join(root, 'index.html'), status: 200 });
    expect(resolveDistFile(root, '/blog')).toEqual({ file: join(root, 'blog.html'), status: 200 });
    expect(resolveDistFile(root, '/blog/douban?x=1')).toEqual({
      file: join(root, 'blog/douban.html'),
      status: 200,
    });
    expect(resolveDistFile(root, '/_media/k/480.webp').status).toBe(200);
    expect(resolveDistFile(root, '/blog/tags/%E4%B8%AD%E6%96%87')).toEqual({
      file: join(root, 'blog/tags/中文.html'),
      status: 200,
    });
  });

  it('answers 404 with the 404 page for missing, escaping or malformed paths', async () => {
    const root = await dist();
    const missing = { file: join(root, '404.html'), status: 404 };
    expect(resolveDistFile(root, '/nope')).toEqual(missing);
    expect(resolveDistFile(root, '/blog/')).toEqual(missing);
    expect(resolveDistFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toEqual(missing);
    expect(resolveDistFile(root, '/%E0%A4%A')).toEqual(missing);
  });
});
