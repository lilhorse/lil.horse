import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectCard from '../../src/components/shell/ProjectCard.astro';
import ProjectPage from '../../src/pages/projects/[slug].astro';
import ProjectsIndex from '../../src/pages/projects/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { content, element, project, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

describe('ProjectCard', () => {
  it('shows name, year, status, stack and the links the title does not use', async () => {
    const html = await render(ProjectCard, {
      project: project('CleanStay', {
        year: 2026,
        status: 'Active',
        stack: ['TypeScript'],
        link: 'https://www.cleanstay.co.nz',
        repo: 'https://github.com/x/cleanstay',
      }),
    });
    expect(html).toContain(
      '<a href="https://www.cleanstay.co.nz" rel="noopener noreferrer">CleanStay/</a>',
    );
    expect(textOf(element(html, '<p class="meta"', 'p'))).toBe('2026 · Active');
    expect(html).toContain('<span class="status status-active">');
    expect(textOf(element(html, '<ul class="stack"', 'ul'))).toBe('TypeScript');
    expect(textOf(element(html, '<ul class="links"', 'ul'))).toBe('↗ source');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('names a project without any link as plain text', async () => {
    const html = await render(ProjectCard, { project: project('Secret', { link: null }) });
    expect(textOf(element(html, '<h2 class="name"', 'h2'))).toBe('Secret/');
    expect(element(html, '<h2 class="name"', 'h2')).not.toContain('<a');
  });
});

describe('projects pages', () => {
  it('lists every project as a card', async () => {
    useSite({ projects: [project('One'), project('Two')] });
    const html = await render(ProjectsIndex);
    expect(html).toContain('<h1 class="sr-only">Projects</h1>');
    expect(html.match(/<article class="card">/g)).toHaveLength(2);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('gives a project page the article layout without comments', async () => {
    const alpha = project('Alpha', { slug: 'alpha', content: content(), order: 1 });
    const beta = project('Beta', {
      slug: 'beta',
      content: content(),
      order: 2,
      year: 2025,
      stack: ['Go'],
      repo: 'https://github.com/x/beta',
    });
    useSite({ projects: [alpha, beta] });
    const html = await render(ProjectPage, { project: beta });
    expect(html).toContain('cat ~/projects/beta.md');
    expect(textOf(element(html, '<div class="doc-meta"', 'div'))).toBe('2025 · Go');
    expect(textOf(element(html, '<ul class="links"', 'ul'))).toBe('↗ example.com ↗ source');
    expect(textOf(element(html, '<nav class="adjacent"', 'nav'))).toBe('‹ previous Alpha');
    expect(await htmlErrors(html)).toEqual([]);
  });
});
