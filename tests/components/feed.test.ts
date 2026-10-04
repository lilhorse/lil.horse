import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/pages/feed.xml';
import { content, post, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite({
    posts: [
      post('new', {
        published: '2024-03-01',
        tags: ['AI', '豆瓣'],
        content: content({
          blocks: [
            {
              type: 'paragraph',
              id: 'p',
              text: [
                {
                  kind: 'text',
                  text: 'See the list',
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: 'default',
                  },
                  href: '/blog/old',
                  pageId: null,
                },
              ],
              color: 'default',
              children: [],
            },
          ],
        }),
      }),
      post('old', { published: '2024-01-01' }),
      post('hidden', { status: 'Unlisted', published: '2024-04-01' }),
    ],
  });
});

describe('feed.xml', () => {
  it('is RSS 2.0 with canonical links, categories, a copyright and a self link', async () => {
    const response = await GET({} as APIContext);
    expect(response.headers.get('content-type')).toBe('application/xml');
    const xml = await response.text();
    expect(xml).toContain(
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    );
    expect(xml).toContain('<link>https://lil.horse</link>');
    expect(xml).toContain('<language>en</language>');
    expect(xml).toContain('<copyright>Content © Lil&apos;Horse, licensed under CC BY-NC 4.0');
    expect(xml).toContain(
      '<atom:link href="https://lil.horse/feed.xml" rel="self" type="application/rss+xml"/>',
    );
    const items = xml.match(/<item>/g) ?? [];
    expect(items).toHaveLength(2);
    expect(xml.indexOf('<link>https://lil.horse/blog/new</link>')).toBeLessThan(
      xml.indexOf('<link>https://lil.horse/blog/old</link>'),
    );
    expect(xml).toContain('<guid isPermaLink="true">https://lil.horse/blog/new</guid>');
    expect(xml).toContain('<category>AI</category><category>豆瓣</category>');
    expect(xml).toContain('<pubDate>Fri, 01 Mar 2024 00:00:00 GMT</pubDate>');
    expect(xml).toContain(
      '<content:encoded>&lt;p&gt;&lt;a href=&quot;https://lil.horse/blog/old&quot;&gt;See the list&lt;/a&gt;&lt;/p&gt;</content:encoded>',
    );
    expect(xml).not.toContain('/blog/hidden');
    expect(xml).not.toMatch(/<link>[^<]*\/<\/link>/);
  });

  it('declares the content namespace even when every post is empty', async () => {
    useSite({ posts: [post('a'), post('b')] });
    const xml = await (await GET({} as APIContext)).text();
    expect(xml).toContain('<content:encoded/>');
    expect(xml).toContain(
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
    );
  });
});
