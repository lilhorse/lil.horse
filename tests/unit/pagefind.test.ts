import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { close, createIndex } from 'pagefind';
import { describe, expect, it, vi } from 'vitest';
import { buildSearchIndex, SEARCH_LANGUAGE, searchIndex } from '../../integrations/pagefind';
import { startServer } from '../helpers/http';
import { tempDir } from '../helpers/temp-dir';

type ServerSetup = Parameters<
  NonNullable<ReturnType<typeof searchIndex>['hooks']['astro:server:setup']>
>[0];
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

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
    const written = (await readdir(join(dist, 'pagefind'), { recursive: true })).sort();
    expect(written.filter((file) => !/^(index|fragment|filter)\/./.test(file))).toEqual([
      'filter',
      'fragment',
      'index',
      'pagefind-entry.json',
      'pagefind-worker.js',
      'pagefind.js',
      expect.stringMatching(/^pagefind\.zh_\w+\.pf_meta$/),
      expect.stringMatching(/^wasm\.\w+\.pagefind$/),
    ]);
    for (const folder of ['index', 'fragment', 'filter'])
      expect(written.some((file) => file.startsWith(`${folder}/`))).toBe(true);
  }, 60_000);

  it('fails instead of shipping an empty index', async () => {
    const dist = await tempDir('pagefind-empty-');
    await writeFile(join(dist, 'index.html'), page('<main data-pagefind-body></main>'));
    await expect(buildSearchIndex(dist)).rejects.toThrow('indexed no page');
  }, 60_000);

  it('fails when no page is marked, instead of indexing whole pages', async () => {
    const dist = await tempDir('pagefind-unmarked-');
    await writeFile(join(dist, 'index.html'), page('<main><p>data-pagefind-body</p></main>'));
    await expect(buildSearchIndex(dist)).rejects.toThrow(
      /^No page under .+ carries data-pagefind-body/,
    );
  }, 60_000);
});

describe('the dev server', () => {
  it("serves the last build's search files with the types browsers need", async () => {
    const root = await tempDir('pagefind-dev-');
    const types: Record<string, string> = {
      'pagefind.js': 'text/javascript; charset=utf-8',
      'pagefind-worker.js': 'text/javascript; charset=utf-8',
      'pagefind-entry.json': 'application/json',
      'search.css': 'text/css; charset=utf-8',
      'pagefind.zh_1.pf_meta': 'application/octet-stream',
      'index/zh_1.pf_index': 'application/octet-stream',
      'fragment/zh_1.pf_fragment': 'application/octet-stream',
      'filter/zh_1.pf_filter': 'application/octet-stream',
      'wasm.zh.pagefind': 'application/octet-stream',
    };
    for (const file of Object.keys(types)) {
      await mkdir(dirname(join(root, 'dist', 'pagefind', file)), { recursive: true });
      await writeFile(join(root, 'dist', 'pagefind', file), 'x');
    }
    const middlewares = new Map<string, Middleware>();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    searchIndex().hooks['astro:server:setup']?.({
      server: {
        middlewares: { use: (path: string, handler: Middleware) => middlewares.set(path, handler) },
      },
    } as unknown as ServerSetup);
    cwd.mockRestore();
    const serve = middlewares.get('/pagefind');
    const server = await startServer((request, response) =>
      serve?.(request, response, () => response.writeHead(404).end()),
    );
    try {
      const served: Record<string, string | null> = {};
      for (const file of Object.keys(types)) {
        const response = await fetch(`${server.url}/${file}`);
        await response.arrayBuffer();
        served[file] = response.headers.get('content-type');
      }
      expect(served).toEqual(types);
    } finally {
      await server.close();
    }
  });
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
