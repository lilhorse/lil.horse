import { beforeEach, describe, expect, it, vi } from 'vitest';
import Neofetch from '../../src/components/shell/Neofetch.astro';
import { bannerBitmap, bannerPath, shimmerBand } from '../../src/lib/banner';
import Home from '../../src/pages/index.astro';
import { htmlErrors, render, textOf } from '../helpers/astro-render';
import { element, masthead, post, profile, project, useSite } from '../helpers/site-data';

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

const TITLE = '𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊';
const SLOGAN = 'Dis is da cyberspace of Lil’Horse, just chill and have fun 🍻.';

describe('Neofetch', () => {
  it('draws the masthead title as a pixel banner named in plain letters', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: TITLE, slogan: SLOGAN } });
    const svg = element(html, '<svg class="banner"', 'svg');
    const banner = bannerBitmap(TITLE, () => undefined);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Lil’Horse"');
    expect(svg).toContain(`viewBox="0 0 ${banner.width} ${banner.height}"`);
    expect(svg).toContain(`width="${banner.width * 4}" height="${banner.height * 4}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(
      `<path id="masthead-letters" fill="url(#masthead-gradient)" d="${bannerPath(banner)}"></path>`,
    );
    expect(
      [...svg.matchAll(/<stop offset="(\d+)%" style="stop-color: var\(--(swatch-\d)\)"/g)].map(
        ([, offset, token]) => `${offset} ${token}`,
      ),
    ).toEqual([
      '0 swatch-1',
      '20 swatch-2',
      '40 swatch-3',
      '60 swatch-4',
      '80 swatch-5',
      '100 swatch-6',
    ]);
    expect(html).not.toContain('lilhorse@lil.horse');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('clips a band of light for the shimmer to the letters, without a second copy of them', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: TITLE, slogan: SLOGAN } });
    const svg = element(html, '<svg class="banner"', 'svg');
    const banner = bannerBitmap(TITLE, () => undefined);
    const band = shimmerBand(banner.width);
    expect(svg).toContain(
      '<clipPath id="masthead-ink"><use href="#masthead-letters"></use></clipPath>',
    );
    expect(svg).toContain(
      `<g clip-path="url(#masthead-ink)"><rect class="shine" x="${-band}" y="0" width="${band}" height="${banner.height}" fill="url(#masthead-shine)" style="--sweep: ${banner.width + band}px"></rect></g>`,
    );
    expect(svg).toContain(
      '<stop offset="0.3" style="stop-color: light-dark(#ffffff1f, #ffffff40)"></stop>' +
        '<stop offset="0.5" style="stop-color: light-dark(#ffffff99, #ffffffbf)"></stop>' +
        '<stop offset="0.7" style="stop-color: light-dark(#ffffff1f, #ffffff40)"></stop>',
    );
    expect(svg.split(bannerPath(banner))).toHaveLength(2);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('prints the slogan between the banner and the rule, ending in a hidden cursor', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: TITLE, slogan: SLOGAN } });
    const slogan = element(html, '<p class="slogan"', 'p');
    expect(slogan).toBe(
      `<p class="slogan" data-slogan><span class="slogan-text">${SLOGAN}</span><span class="cursor" aria-hidden="true">▋</span></p>`,
    );
    expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf(slogan));
    expect(html.indexOf(slogan)).toBeLessThan(html.indexOf('<p class="rule"'));
  });

  it('moves the resting cursor from the slogan to the end of the stack note', async () => {
    const html = await render(Neofetch, {
      profile: { ...profile, stack: ['TypeScript', 'Go'] },
      masthead: { title: TITLE, slogan: SLOGAN },
    });
    expect(html).toContain('<div class="neofetch" data-intro>');
    expect(element(html, '<p class="slogan"', 'p')).toBe(
      `<p class="slogan" data-slogan><span class="slogan-text">${SLOGAN}</span></p>`,
    );
    expect(html).toContain(
      '<dd data-stack><s>TypeScript</s>\u00a0· <s>Go</s><span class="comment" data-note><span class="note-text"> # DEPRECATED: use Claude &amp; Codex instead 😎</span><span class="cursor" aria-hidden="true">▋</span></span></dd>',
    );
    expect(html.match(/class="cursor"/g)).toHaveLength(1);
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('keeps a short title title-sized', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: 'Hi', slogan: null } });
    const banner = bannerBitmap('Hi', () => undefined);
    expect(html).toContain(`width="${banner.width * 5}" height="${banner.height * 5}"`);
  });

  it('leaves out the slogan when the root page has none', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: TITLE, slogan: null } });
    expect(html).not.toContain('slogan');
  });

  it('prints a title that the banner font cannot draw as text', async () => {
    const html = await render(Neofetch, { profile, masthead: { title: '小马', slogan: null } });
    expect(html).not.toContain('<svg class="banner"');
    expect(textOf(element(html, '<p class="title"', 'p'))).toBe('小马');
  });

  it('prints the profile fields and never the whole email address', async () => {
    const html = await render(Neofetch, {
      masthead,
      profile: {
        ...profile,
        email: 'sup@lil.horse',
        github: 'lilhorse',
        stack: ['TypeScript', 'Go'],
        bio: 'Indie Coder & GFW Hater.',
      },
    });
    expect(rows(html)).toEqual([
      'Role: Developer',
      'Location: Auckland',
      'Stack: TypeScript\u00a0· Go # DEPRECATED: use Claude &amp; Codex instead 😎▋',
      'Status: Open to work',
      'Contact: sup@lil.horse · github',
    ]);
    expect(html).not.toContain('sup@lil.horse');
    expect(html).toContain('sup<!-- -->@<!-- -->lil.horse');
    expect(html).toContain('<dd class="status open">');
    expect(html).toContain('<p class="bio">Indie Coder &amp; GFW Hater.</p>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('keeps each stack item and its separator together when the line wraps', async () => {
    const html = await render(Neofetch, {
      masthead,
      profile: { ...profile, stack: ['TypeScript', 'Tailwind CSS', 'Go'] },
    });
    expect(html).toContain('<s>TypeScript</s>\u00a0· <s>Tailwind\u00a0CSS</s>\u00a0· <s>Go</s>');
  });

  it('leaves out the stack and contact rows when they are empty', async () => {
    const html = await render(Neofetch, {
      masthead,
      profile: { ...profile, availability: 'Busy' },
    });
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

  it('heads the card with the masthead from the root page', async () => {
    useSite({ masthead: { title: TITLE, slogan: SLOGAN } });
    const html = await render(Home);
    expect(html).toContain('aria-label="Lil’Horse"');
    expect(html).toContain(`<span class="slogan-text">${SLOGAN}</span>`);
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
