import { beforeEach, describe, expect, it, vi } from 'vitest';
import Neofetch from '../../src/components/shell/Neofetch.astro';
import Home from '../../src/pages/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { element, post, profile, project, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

beforeEach(() => {
  useSite();
});

const rows = (html: string) =>
  [...html.matchAll(/<dt>(.*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(
    ([, term = '', value = '']) => `${textOf(term)}: ${textOf(value)}`,
  );

describe('Neofetch', () => {
  it('prints the profile fields and never the whole email address', async () => {
    const html = await render(Neofetch, {
      profile: {
        ...profile,
        email: 'sup@lil.horse',
        github: 'lilhorse',
        stack: ['TypeScript', 'Go'],
        bio: 'Indie Coder & GFW Hater.',
      },
    });
    expect(textOf(element(html, '<p class="title"', 'p'))).toBe('lilhorse@lil.horse');
    expect(rows(html)).toEqual([
      'Role: Developer',
      'Location: Auckland',
      'Stack: TypeScript · Go',
      'Status: Open to work',
      'Contact: sup@lil.horse · github',
    ]);
    expect(html).not.toContain('sup@lil.horse');
    expect(html).toContain('sup<!-- -->@<!-- -->lil.horse');
    expect(html).toContain('<dd class="status open">');
    expect(html).toContain('<p class="bio">Indie Coder &amp; GFW Hater.</p>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('leaves out the stack and contact rows when they are empty', async () => {
    const html = await render(Neofetch, { profile: { ...profile, availability: 'Busy' } });
    expect(rows(html)).toEqual(['Role: Developer', 'Location: Auckland', 'Status: Busy']);
    expect(html).toContain('<dd class="status busy">');
  });
});

describe('home page', () => {
  it('runs neofetch under a hidden h1 with the profile name', async () => {
    const html = await render(Home);
    expect(html).toMatch(/<h1 class="sr-only">Lil(&#39;|')Horse<\/h1>/);
    expect(html).toContain('neofetch');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('lists posts as files with their date, draft marker and tags', async () => {
    useSite({
      posts: [
        post('draft', { status: 'Draft', published: '2024-03-01', tags: ['wip'] }),
        post('hello', { tags: ['helloworld', 'AI'] }),
      ],
    });
    const list = textOf(element(await render(Home), '<ul class="posts files"', 'section'));
    expect(list).toContain('2024-03-01 draft.md DRAFT #wip');
    expect(list).toContain('2024-01-11 hello.md #helloworld #AI');
  });

  it('leaves out the projects section when no project is featured', async () => {
    useSite({ projects: [project('Quiet')] });
    expect(await render(Home)).not.toContain('ls ~/projects');
    useSite({ projects: [project('Loud', { featured: true })] });
    const html = await render(Home);
    expect(html).toContain('<h2 class="sr-only">Projects</h2>');
    expect(html).toContain(
      '<a href="https://example.com" rel="noopener noreferrer">Loud<span aria-hidden="true">/</span></a>',
    );
  });

  it('names a featured project without any link as plain text', async () => {
    useSite({ projects: [project('Plain', { featured: true, link: null })] });
    expect(await render(Home)).toContain(
      '<span class="name">Plain<span aria-hidden="true">/</span></span>',
    );
  });
});
