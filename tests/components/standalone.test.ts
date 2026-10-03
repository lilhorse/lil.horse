import { beforeEach, describe, expect, it, vi } from 'vitest';
import StandalonePage from '../../src/components/StandalonePage.astro';
import { excerpt } from '../../src/notion/text';
import type { StandalonePageEntry } from '../../src/notion/types';
import NotFound from '../../src/pages/404.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { content, element, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

const page = (key: StandalonePageEntry['key'], firstParagraph: string | null = null) => ({
  id: key,
  key,
  title: key === 'about' ? 'About' : 'Contact',
  icon: null,
  cover: null,
  lastEditedTime: '2024-01-11T00:00:00.000Z',
  content: content({ firstParagraph }),
});

beforeEach(() => {
  useSite({ pages: [page('about'), page('contact')] });
});

describe('standalone pages', () => {
  it('truncates the first paragraph for the meta description', async () => {
    const firstParagraph = `${'word '.repeat(60)}end`;
    useSite({ pages: [page('about', firstParagraph)] });
    const html = await render(StandalonePage, { pageKey: 'about' });
    const description = /<meta name="description" content="([^"]*)">/.exec(html)?.[1];
    expect(description).toBe(excerpt(firstParagraph));
    expect(description).toMatch(/…$/);
  });

  it('cats about.md under the about tab', async () => {
    const html = await render(StandalonePage, { pageKey: 'about' });
    expect(html).toContain('cat ~/about.md');
    expect(html).toContain('<a class="tab active" href="/about" aria-current="page">about</a>');
    expect(textOf(element(html, '<h1 class="title"', 'h1'))).toBe('# About');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('opens contact.md in its own tab', async () => {
    const html = await render(StandalonePage, { pageKey: 'contact' });
    expect(html).toContain('cat ~/contact.md');
    expect(html).toContain('<span class="tab active">contact.md</span>');
  });
});

describe('404 page', () => {
  it('prints command not found and fills in the path at runtime', async () => {
    const html = await render(NotFound, {}, 'https://lil.horse/404.html');
    expect(html).toContain('<h1 class="sr-only">Page not found</h1>');
    expect(textOf(element(html, '<p class="error"', 'p')).trim()).toBe('zsh: command not found:');
    expect(html).toContain('<span data-missing hidden>');
    expect(html).toMatch(/<script>\s*\{\s*let path = location\.pathname;/);
    expect(await htmlErrors(html)).toEqual([]);
  });
});
