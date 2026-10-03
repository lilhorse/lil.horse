import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ogImagePath, ogTargets, stripEmoji } from '../../src/lib/og';
import { renderOg } from '../../src/og/render';
import { NIGHT, ogTree } from '../../src/og/template';
import { content, post, profile, project } from '../helpers/site-data';

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe('ogTargets', () => {
  it('covers the home page, every post, project pages and the two standalone pages', () => {
    const targets = ogTargets({
      profile: { ...profile, role: 'Developer', location: 'Auckland' },
      posts: [post('douban', { tags: ['豆瓣', 'AI'], published: '2024-02-29' })],
      projects: [
        project('Site', { slug: 'site', content: content(), year: 2026, stack: ['Astro'] }),
        project('Card only', { link: 'https://example.com' }),
      ],
      pages: [
        {
          id: 'a',
          key: 'about',
          title: 'About',
          icon: null,
          cover: null,
          lastEditedTime: '2024-01-11T00:00:00.000Z',
          content: content(),
        },
      ],
    });
    expect(targets.map((target) => ogImagePath(target.type, target.slug))).toEqual([
      '/og/site/home.png',
      '/og/blog/douban.png',
      '/og/projects/site.png',
      '/og/pages/about.png',
    ]);
    expect(targets[0]).toMatchObject({
      title: "Lil'Horse",
      command: 'neofetch',
      meta: ['Developer', 'Auckland'],
    });
    expect(targets[1]).toMatchObject({
      command: 'cat ~/blog/douban.md',
      path: '~/blog/douban.md',
      meta: ['2024-02-29', '#豆瓣', '#AI'],
    });
    expect(targets[2]?.meta).toEqual(['2026', 'Astro']);
  });
});

describe('stripEmoji', () => {
  it('removes emoji and tidies the spaces they leave', () => {
    expect(stripEmoji('Hello 👋🏻 World ✨')).toBe('Hello World');
    expect(stripEmoji('我的豆瓣备份')).toBe('我的豆瓣备份');
    expect(stripEmoji('🎬')).toBe('');
  });
});

describe('ogTree', () => {
  it('uses only the night theme values from tokens.css', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const dark = new Set(
      [...tokens.matchAll(/light-dark\(#[0-9a-f]{6}, (#[0-9a-f]{6})\)/g)].map((m) => m[1]),
    );
    const template = readFileSync('src/og/template.ts', 'utf8');
    for (const hex of template.match(/#[0-9a-f]{6}/g) ?? []) expect(dark, hex).toContain(hex);
    expect(Object.values(NIGHT).flat()).toHaveLength(12);
  });

  it('clamps the title to three lines in a block', () => {
    const json = JSON.stringify(ogTree({ title: 'T', command: 'c', path: 'p', meta: [] }));
    expect(json).toContain('"display":"block"');
    expect(json).toContain('"lineClamp":3');
    expect(json).toContain('"src":"data:image/svg+xml;base64,');
  });
});

describe('renderOg', () => {
  const target = (title: string) => ({
    type: 'blog' as const,
    slug: 'x',
    title,
    command: 'cat ~/blog/x.md',
    path: '~/blog/x.md',
    meta: ['2024-02-29', '#豆瓣'],
  });

  it('renders Latin and Chinese titles as 1200 × 630 PNGs without missing glyphs', async () => {
    const warnings: string[] = [];
    const started = performance.now();
    const latin = await renderOg(
      target(
        'A very long title that keeps going and going and going until it must wrap onto a fourth line',
      ),
      (m) => warnings.push(m),
    );
    const chinese = await renderOg(target('我的豆瓣备份：一百六十五部电影与剧集'), (m) =>
      warnings.push(m),
    );
    const elapsed = performance.now() - started;
    expect(pngSize(latin)).toEqual({ width: 1200, height: 630 });
    expect(pngSize(chinese)).toEqual({ width: 1200, height: 630 });
    expect(warnings).toEqual([]);
    expect(latin.length).toBeGreaterThan(5000);
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);

  it('reports characters no font covers', async () => {
    const warnings: string[] = [];
    await renderOg(target('Rare 𠮷 glyph'), (m) => warnings.push(m));
    expect(warnings).toEqual([expect.stringContaining('no font covers "𠮷"')]);
  }, 60_000);
});
