import { describe, expect, it, vi } from 'vitest';
import {
  cleanExcerpt,
  pageHref,
  runSearch,
  segmentQuery,
  type Searcher,
} from '../../src/scripts/search';

function searcher(answers: Record<string, string[]>): Searcher & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(query) {
      queries.push(query);
      return {
        results: (answers[query] ?? []).map((url) => ({
          data: async () => ({
            url,
            excerpt: `<p>Found <mark>it</mark> <b>here</b></p>`,
            meta: { title: `Title of ${url}`, date: '2024-01-11', lang: 'zh-Hans' },
          }),
        })),
      };
    },
  };
}

describe('segmentQuery', () => {
  it('splits Chinese into dictionary words and keeps English words', () => {
    expect(segmentQuery('当哈利遇到莎莉')).toBe('当 哈利 遇到 莎莉');
    expect(segmentQuery("  Schindler's List ")).toBe("Schindler's List");
    expect(segmentQuery('用Astro重写').split(' ')).toContain('Astro');
  });

  it('returns the query itself when segmentation is unavailable or finds no words', () => {
    expect(segmentQuery('…')).toBe('…');
    const original = Intl.Segmenter;
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    try {
      expect(segmentQuery('当哈利遇到莎莉')).toBe('当哈利遇到莎莉');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Intl.Segmenter).toBe(original);
  });
});

describe('pageHref and cleanExcerpt', () => {
  it('turns built file names into routes', () => {
    expect(pageHref('/blog/douban.html')).toBe('/blog/douban');
    expect(pageHref('/index.html')).toBe('/');
    expect(pageHref('/blog/tags/%E8%B1%86%E7%93%A3.html')).toBe('/blog/tags/%E8%B1%86%E7%93%A3');
  });

  it('keeps only the match marks of an excerpt', () => {
    expect(cleanExcerpt('<p>Found <mark>it</mark> <b>here</b><img src=x onerror=1></p>')).toBe(
      'Found <mark>it</mark> here',
    );
  });
});

describe('runSearch', () => {
  it('searches the segmented query first and falls back to the raw one', async () => {
    const engine = searcher({ 当哈利遇到莎莉: ['/blog/douban.html'] });
    const results = await runSearch(engine, ' 当哈利遇到莎莉 ', 8);
    expect(engine.queries).toEqual(['当 哈利 遇到 莎莉', '当哈利遇到莎莉']);
    expect(results).toEqual([
      {
        href: '/blog/douban',
        title: 'Title of /blog/douban.html',
        excerpt: 'Found <mark>it</mark> here',
        date: '2024-01-11',
        lang: 'zh-Hans',
      },
    ]);
  });

  it('does not repeat an identical raw query and limits the results', async () => {
    const engine = searcher({ hello: ['/a.html', '/b.html', '/c.html'] });
    const results = await runSearch(engine, 'hello', 2);
    expect(engine.queries).toEqual(['hello']);
    expect(results.map((result) => result.href)).toEqual(['/a', '/b']);
    expect(await runSearch(engine, '   ', 2)).toEqual([]);
  });
});
