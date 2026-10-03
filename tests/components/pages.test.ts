import { beforeEach, describe, expect, it, vi } from 'vitest';
import StandalonePage from '../../src/components/StandalonePage.astro';
import { excerpt } from '../../src/notion/text';
import type { StandalonePageEntry } from '../../src/notion/types';
import ProjectsIndex from '../../src/pages/projects/index.astro';
import { render, textOf } from '../helpers/astro-render';
import { content, element, project, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('projects page', () => {
  it('separates the name, year and status', async () => {
    useSite({ projects: [project('CleanStay', { year: 2026, status: 'Active' })] });
    const main = (await render(ProjectsIndex)).split('<main')[1] ?? '';
    const item = element(main, '<li>', 'li');
    expect(textOf(item.slice(0, item.indexOf('<p>')))).toBe('CleanStay 2026 Active');
  });
});

describe('standalone pages', () => {
  it('truncates the first paragraph for the meta description', async () => {
    const firstParagraph = `${'word '.repeat(60)}end`;
    const page: StandalonePageEntry = {
      id: 'about',
      key: 'about',
      title: 'About',
      icon: null,
      cover: null,
      lastEditedTime: '2024-01-11T00:00:00.000Z',
      content: content({ firstParagraph }),
    };
    useSite({ pages: [page] });
    const html = await render(StandalonePage, { pageKey: 'about' });
    const description = /<meta name="description" content="([^"]*)">/.exec(html)?.[1];
    expect(description).toBe(excerpt(firstParagraph));
    expect(description).toMatch(/…$/);
  });
});
