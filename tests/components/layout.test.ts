import { beforeEach, describe, expect, it, vi } from 'vitest';
import SiteFooter from '../../src/components/shell/SiteFooter.astro';
import SiteHeader from '../../src/components/shell/SiteHeader.astro';
import NotFound from '../../src/pages/404.astro';
import BlogIndex from '../../src/pages/blog/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { element, post, profile, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('SiteHeader', () => {
  it('marks the current section tab as the page', async () => {
    const html = await render(SiteHeader, { current: 'blog', path: '~/blog', file: null });
    expect(html).toContain('<a class="tab active" href="/blog" aria-current="page">blog</a>');
    expect(html).toContain('<a class="tab" href="/projects">projects</a>');
    expect(html).toMatch(/<a class="tab" href="\/">.*~\/lil\.horse<\/a>/);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('adds an active file tab for documents', async () => {
    const html = await render(SiteHeader, {
      current: null,
      path: '~/blog/douban.md',
      file: 'douban.md',
    });
    expect(html).toContain('<li aria-hidden="true"><span class="tab active">douban.md</span></li>');
    expect(html).not.toContain('aria-current');
  });

  it('shows the path, a home logo and a menu for phones', async () => {
    const html = await render(SiteHeader, {
      current: 'contact',
      path: '~/contact.md',
      file: 'contact.md',
    });
    expect(html).toContain('<span class="path">~/contact.md</span>');
    expect(html).toContain('<a class="home" href="/" aria-label="Home">');
    expect(html).toContain('<details class="site-menu">');
    expect(html).toMatch(/<a href="\/contact" aria-current="page">.*contact<\/a>/);
    expect(textOf(element(html, '<nav class="panel"', 'nav'))).toBe(
      'go to~ home ▸ blog ▸ projects ▸ about ▸ contact',
    );
  });

  it('draws both logo palettes and leaves the choice to CSS', async () => {
    const html = await render(SiteHeader, { current: null, path: '~', file: null });
    expect(html.match(/<span class="theme-light">/g)).toHaveLength(2);
    expect(html.match(/<span class="theme-dark">/g)).toHaveLength(2);
  });

  it('offers a theme button whose icon and label CSS picks by preference', async () => {
    const html = await render(SiteHeader, { current: null, path: '~', file: null });
    const button = element(html, '<button class="theme-toggle"', 'button');
    expect(button).toContain('type="button" data-theme-toggle');
    expect(button).toContain('<span class="sr-only">Theme: </span>');
    for (const name of ['system', 'light', 'dark']) {
      expect(button).toContain(`<svg class="icon icon-${name}"`);
      expect(button).toContain(`<span class="label label-${name}">${name}</span>`);
    }
    expect(await htmlErrors(html)).toEqual([]);
  });
});

describe('SiteFooter', () => {
  it('lists social links, the contact page, the licences and the build', async () => {
    const html = await render(SiteFooter, {
      social: [{ label: 'github', href: 'https://github.com/lilhorse' }],
      version: '70af70f',
    });
    expect(html).toContain(
      '<a href="https://github.com/lilhorse" rel="me noopener noreferrer">github</a>',
    );
    expect(html).toContain('<a href="/contact">contact</a>');
    expect(html).toContain('<a href="/feed.xml">rss</a>');
    expect(html).toContain('rel="license noopener noreferrer">CC BY-NC 4.0</a>');
    expect(html).toContain(
      '<a href="https://github.com/lilhorse/lil.horse/blob/main/LICENSE" rel="noopener noreferrer">MIT</a>',
    );
    expect(textOf(element(html, '<p class="legal"', 'p'))).toBe(
      "© Lil'Horse · Content CC BY-NC 4.0 · Code MIT · build 70af70f",
    );
    expect(await htmlErrors(html)).toEqual([]);
  });
});

describe('Base layout', () => {
  it('names the section tabs and keeps contact out of them', async () => {
    const html = await render(NotFound);
    expect(textOf(element(html, '<nav class="tabs" aria-label="Primary"', 'nav'))).toBe(
      '~/lil.horse blog projects about',
    );
    expect(element(html, '<nav aria-label="Elsewhere"', 'nav')).toContain('href="/contact"');
  });

  it('links the icons, the manifest and exactly two preloaded fonts', async () => {
    const html = await render(BlogIndex, {}, 'https://lil.horse/blog.html');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
    expect(html).toMatch(
      /<link rel="alternate" type="application\/rss\+xml" title="Lil(&#39;|')Horse" href="\/feed\.xml">/,
    );
    expect(html.match(/<link rel="preload"[^>]* as="font"/g)).toHaveLength(2);
    expect(html).toContain(
      '<meta name="theme-color" content="#16161e" media="(prefers-color-scheme: dark)">',
    );
  });

  it('sets the theme in <head> before anything renders', async () => {
    const html = await render(BlogIndex, {}, 'https://lil.horse/blog.html');
    expect(html).toMatch(
      /media="\(prefers-color-scheme: dark\)">\s*<script>\(\(\)=>\{let p="system";/,
    );
    expect(html.indexOf('let p="system"')).toBeLessThan(html.indexOf('<body'));
  });

  it('asks the browser to prerender hovered page links', async () => {
    const html = await render(BlogIndex, {}, 'https://lil.horse/blog.html');
    const rules = /<script type="speculationrules">(.*?)<\/script>/s.exec(html)?.[1] ?? '';
    const parsed = JSON.parse(rules) as { prerender: { eagerness: string; where: unknown }[] };
    expect(parsed.prerender).toHaveLength(1);
    expect(parsed.prerender[0]?.eagerness).toBe('moderate');
    expect(JSON.stringify(parsed.prerender[0]?.where)).toContain('/feed.xml');
  });

  it('gives pages a canonical URL, except the 404 page', async () => {
    useSite({ posts: [post('hello')] });
    const blog = await render(BlogIndex, {}, 'https://lil.horse/blog.html');
    const missing = await render(NotFound, {}, 'https://lil.horse/404.html');
    expect(blog).toContain('<link rel="canonical" href="https://lil.horse/blog">');
    expect(missing).not.toContain('rel="canonical"');
    expect(await htmlErrors(missing)).toEqual([]);
  });

  it('shows the profile links and the build in the footer', async () => {
    useSite({ profile: { ...profile, github: 'lilhorse', x: '@lilhorse' } });
    const footer = element(await render(NotFound), '<footer class="site-footer"', 'footer');
    expect(footer).toContain('href="https://github.com/lilhorse"');
    expect(footer).toContain('href="https://x.com/lilhorse"');
    expect(footer).toMatch(/build <span class="build">(?:[0-9a-f]{7}|unknown)<\/span>/);
  });
});
