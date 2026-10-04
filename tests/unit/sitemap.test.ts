import { describe, expect, it } from 'vitest';
import { robotsTxt, sitemapEntries, sitemapIndexXml, sitemapXml } from '../../src/lib/sitemap';
import { tagIndex } from '../../src/lib/tags';
import { content, post, project } from '../helpers/site-data';

const SITE = 'https://lil.horse';

describe('sitemapEntries', () => {
  it('lists pages, listed posts with edit dates, project pages and encoded tag pages', () => {
    const posts = [
      post('new', { published: '2024-03-01', updated: '2024-03-05', tags: ['豆瓣'] }),
      post('old', { published: '2024-01-01' }),
      post('hidden', { status: 'Unlisted', published: '2024-02-01' }),
    ];
    const entries = sitemapEntries(
      {
        posts,
        projects: [project('Site', { slug: 'site', content: content() }), project('Card only')],
        pages: [
          {
            id: 'a',
            key: 'about',
            title: 'About',
            icon: null,
            cover: null,
            lastEditedTime: '',
            content: content(),
          },
          {
            id: 'c',
            key: 'contact',
            title: 'Contact',
            icon: null,
            cover: null,
            lastEditedTime: '',
            content: content(),
          },
        ],
        tags: tagIndex(posts),
      },
      SITE,
    );
    expect(entries).toEqual([
      { url: 'https://lil.horse/' },
      { url: 'https://lil.horse/blog' },
      { url: 'https://lil.horse/projects' },
      { url: 'https://lil.horse/about' },
      { url: 'https://lil.horse/contact' },
      { url: 'https://lil.horse/blog/new', lastmod: '2024-03-05' },
      { url: 'https://lil.horse/blog/old', lastmod: '2024-01-01' },
      { url: 'https://lil.horse/projects/site' },
      { url: 'https://lil.horse/blog/tags/%E8%B1%86%E7%93%A3' },
    ]);
  });
});

describe('sitemap and robots files', () => {
  it('writes the urlset, the index and robots.txt', () => {
    expect(
      sitemapXml([
        { url: 'https://lil.horse/a?x=1&y=2', lastmod: '2024-01-01' },
        { url: 'https://lil.horse/b' },
      ]),
    ).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://lil.horse/a?x=1&amp;y=2</loc><lastmod>2024-01-01</lastmod></url>\n<url><loc>https://lil.horse/b</loc></url>\n</urlset>\n',
    );
    expect(sitemapIndexXml(SITE)).toContain(
      '<sitemap><loc>https://lil.horse/sitemap-0.xml</loc></sitemap>',
    );
    expect(robotsTxt(SITE)).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://lil.horse/sitemap-index.xml\n',
    );
  });
});
