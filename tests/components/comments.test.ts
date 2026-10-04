import { describe, expect, it } from 'vitest';
import Comments from '../../src/components/shell/Comments.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';

describe('Comments', () => {
  it('names the discussion by slug and hands the loader the repository and theme URLs', async () => {
    const html = await render(Comments, { slug: 'douban' });
    expect(html).toContain('<section class="comments" aria-labelledby="comments-title">');
    expect(textOf(html)).toContain('giscus --term douban');
    expect(html).toContain('<h2 id="comments-title" class="sr-only">Comments</h2>');
    expect(html).toContain(
      '<div class="giscus" data-comments data-repo="lilhorse/lil.horse" data-repo-id="R_kgDOGbvmeg" data-category="Announcements" data-category-id="DIC_kwDOGbvmes4CcjmH" data-term="douban"',
    );
    expect(html).toMatch(/data-theme-light="(light|https:\/\/lil\.horse\/giscus\/mist\.css)"/);
    expect(html).toMatch(/data-theme-dark="(dark|https:\/\/lil\.horse\/giscus\/night\.css)"/);
    expect(await htmlErrors(html)).toEqual([]);
  });
});
