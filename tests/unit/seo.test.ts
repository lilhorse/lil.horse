import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  jsonLdHtml,
  personJsonLd,
} from '../../src/lib/seo';
import { post, profile } from '../helpers/site-data';

const SITE = 'https://lil.horse';

describe('jsonLdHtml and absoluteUrl', () => {
  it('escapes < so a value can never close the script', () => {
    expect(jsonLdHtml({ name: '</script><b>' })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
    expect(absoluteUrl('/blog/x', SITE)).toBe('https://lil.horse/blog/x');
  });
});

describe('personJsonLd', () => {
  it('describes the author with the social profiles', () => {
    expect(personJsonLd({ ...profile, github: 'lilhorse', x: '@lilhorse' }, SITE)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: "Lil'Horse",
      jobTitle: 'Developer',
      url: SITE,
      sameAs: ['https://github.com/lilhorse', 'https://x.com/lilhorse'],
    });
  });
});

describe('blogPostingJsonLd', () => {
  it('fills in every field and falls back to the publish date', () => {
    const data = blogPostingJsonLd(
      post('douban', { language: 'zh', tags: ['豆瓣', 'AI'], updated: '2024-03-01' }),
      profile,
      SITE,
    );
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: 'Post douban',
      description: 'About it',
      url: 'https://lil.horse/blog/douban',
      mainEntityOfPage: 'https://lil.horse/blog/douban',
      datePublished: '2024-01-11',
      dateModified: '2024-03-01',
      author: { '@type': 'Person', name: "Lil'Horse", url: SITE },
      image: 'https://lil.horse/og/blog/douban.png',
      inLanguage: 'zh-Hans',
      keywords: '豆瓣, AI',
    });
    const bare = blogPostingJsonLd(post('x', { description: '' }), profile, SITE);
    expect(bare.dateModified).toBe('2024-01-11');
    expect(bare.inLanguage).toBe('en');
    expect(bare).not.toHaveProperty('keywords');
    expect(bare).not.toHaveProperty('description');
  });
});

describe('breadcrumbJsonLd', () => {
  it('numbers the trail from one', () => {
    expect(
      breadcrumbJsonLd([
        { name: 'Home', url: SITE },
        { name: 'Blog', url: `${SITE}/blog` },
      ]),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
      ],
    });
  });
});
