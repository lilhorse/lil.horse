import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HtmlValidate, StaticConfigLoader } from 'html-validate';
import { describe, expect, it } from 'vitest';
import { checkDist } from '../../src/lib/dist-check';

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

async function dist(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dist-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const noValidation = { jsBudgetBytes: 200, cssBudgetBytes: 200, validator: null };

describe('checkDist', () => {
  it('accepts a clean site', async () => {
    const root = await dist({
      'index.html': page(
        '<a href="/blog">blog</a><img src="/_media/k/480.webp" srcset="/_media/k/480.webp 480w" alt="">',
      ),
      'blog.html': page('<a href="/">home</a><a href="/blog/">again</a>'),
      '_media/k/480.webp': 'x',
    });
    expect(await checkDist(root, noValidation)).toEqual([]);
  });

  it('reports expiring URLs, missing targets and budget overruns', async () => {
    const noise = randomBytes(3000).toString('base64');
    const root = await dist({
      'index.html': page(
        `<a href="/missing">x</a><img src="https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?X-Amz-Signature=1" alt=""><script>${noise}</script><style>${noise}</style>`,
      ),
    });
    const messages = (await checkDist(root, noValidation)).map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'contains an expiring Notion file URL',
        'links to missing /missing',
        expect.stringMatching(/^initial JavaScript is \d+ bytes gzipped/),
        expect.stringMatching(/^CSS is \d+ bytes gzipped/),
      ]),
    );
  });

  it('reports HTML validation errors', async () => {
    const root = await dist({ 'index.html': page('<p id="x">one</p><p id="x">two</p>') });
    const validator = new HtmlValidate(
      new StaticConfigLoader({ extends: ['html-validate:standard'] }),
    );
    const issues = await checkDist(root, { ...noValidation, validator });
    expect(issues.some((issue) => issue.message.startsWith('html-validate no-dup-id'))).toBe(true);
  });
});
