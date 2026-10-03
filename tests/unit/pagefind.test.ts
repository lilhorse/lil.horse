import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { close, createIndex } from 'pagefind';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, SEARCH_LANGUAGE } from '../../integrations/pagefind';
import { tempDir } from '../helpers/temp-dir';

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

const article = page(
  '<article data-pagefind-body data-pagefind-meta="type:post">' +
    '<p data-pagefind-ignore>❯ cat ~/blog/douban.md</p>' +
    '<h1 data-pagefind-meta="title[data-title]" data-title="My Douban Backup"># My Douban Backup</h1>' +
    '<div data-pagefind-ignore><time data-pagefind-meta="date">2024-01-11</time> · 2 min read' +
    '<span data-pagefind-filter="tag[data-tag]" data-tag="AI">#AI</span></div>' +
    '<p>辛德勒的名单 is on the list.</p></article>',
);

describe('buildSearchIndex', () => {
  it('writes one Chinese-segmented index of the pages marked as searchable', async () => {
    const dist = await tempDir('pagefind-');
    await mkdir(join(dist, 'blog'), { recursive: true });
    await writeFile(join(dist, 'blog', 'douban.html'), article);
    await writeFile(
      join(dist, 'about.html'),
      page('<article data-pagefind-body><h1>About</h1><p>Hello</p></article>'),
    );
    await writeFile(join(dist, 'index.html'), page('<main><p>neofetch</p></main>'));
    const count = await buildSearchIndex(dist);
    expect(count).toBe(2);
    const entry = JSON.parse(
      await readFile(join(dist, 'pagefind', 'pagefind-entry.json'), 'utf8'),
    ) as { languages: Record<string, { page_count: number }> };
    expect(Object.keys(entry.languages)).toEqual([SEARCH_LANGUAGE]);
    expect(entry.languages[SEARCH_LANGUAGE]?.page_count).toBe(2);
    expect(existsSync(join(dist, 'pagefind', 'pagefind.js'))).toBe(true);
  }, 60_000);

  it('fails instead of shipping an empty index', async () => {
    const dist = await tempDir('pagefind-empty-');
    await expect(buildSearchIndex(dist)).rejects.toThrow('indexed no page');
  }, 60_000);
});

describe('searchable markup', () => {
  it('reads the title from its attribute and keeps meta and filters inside ignored elements', async () => {
    const created = await createIndex({ forceLanguage: SEARCH_LANGUAGE });
    try {
      const added = await created.index?.addHTMLFile({
        sourcePath: 'blog/douban.html',
        content: article,
      });
      expect(added?.errors).toEqual([]);
      expect(added?.file.url).toBe('/blog/douban.html');
      expect(added?.file.meta).toEqual({
        title: 'My Douban Backup',
        date: '2024-01-11',
        type: 'post',
      });
    } finally {
      await close();
    }
  }, 60_000);
});
