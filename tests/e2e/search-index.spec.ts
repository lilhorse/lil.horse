import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { pagePaths } from './site';

test('ships one Chinese-segmented index covering every searchable page', async ({ request }) => {
  const entry = (await (await request.get('/pagefind/pagefind-entry.json')).json()) as {
    languages: Record<string, { page_count: number }>;
  };
  expect(Object.keys(entry.languages)).toEqual(['zh']);
  const searchable = pagePaths().filter((path) =>
    readFileSync(`dist/${path === '/' ? 'index' : path.slice(1)}.html`, 'utf8').includes(
      'data-pagefind-body',
    ),
  );
  expect(searchable.length).toBeGreaterThan(0);
  expect(entry.languages.zh?.page_count).toBe(searchable.length);
});
