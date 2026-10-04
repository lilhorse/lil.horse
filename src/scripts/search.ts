export interface SearchResult {
  href: string;
  title: string;
  excerpt: string;
  date: string | null;
  lang: string | null;
}

export interface SearchHit {
  data(): Promise<{ url: string; excerpt: string; meta: Record<string, string | undefined> }>;
}

export interface Searcher {
  search(query: string): Promise<{ results: SearchHit[] }>;
}

/** Pagefind reports built file names; visitors see the routes. */
export function pageHref(url: string): string {
  return url.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
}

/** Pagefind marks matches with <mark>; nothing else from the excerpt is kept as markup. */
export function cleanExcerpt(html: string): string {
  return html.replace(/<(?!\/?mark>)[^>]*>/g, '');
}

/** Splits a query into words the way the index was built (Chinese segmentation). */
export function segmentQuery(query: string): string {
  const trimmed = query.trim();
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return trimmed;
  const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(trimmed)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);
  return words.length > 0 ? words.join(' ') : trimmed;
}

export async function runSearch(
  searcher: Searcher,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const raw = query.trim();
  if (!raw) return [];
  const segmented = segmentQuery(raw);
  let { results } = await searcher.search(segmented);
  if (results.length === 0 && segmented !== raw) ({ results } = await searcher.search(raw));
  return Promise.all(
    results.slice(0, limit).map(async (hit) => {
      const data = await hit.data();
      const href = pageHref(data.url);
      return {
        href,
        title: data.meta.title ?? href,
        excerpt: cleanExcerpt(data.excerpt),
        date: data.meta.date ?? null,
        lang: data.meta.lang ?? null,
      };
    }),
  );
}

export async function loadPagefind(): Promise<Searcher | null> {
  try {
    const url = '/pagefind/pagefind.js';
    const pagefind = (await import(/* @vite-ignore */ url)) as Searcher & {
      options?(settings: Record<string, unknown>): Promise<void>;
    };
    await pagefind.options?.({ excerptLength: 24 });
    return pagefind;
  } catch {
    return null;
  }
}
