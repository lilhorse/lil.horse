import { readFileSync } from 'node:fs';
import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bannerBitmap, halfBlocks } from '../../src/lib/banner';
import { GET as horse, getStaticPaths } from '../../src/pages/brand/[name].svg';
import { GET as readme } from '../../src/pages/profile/README.md';
import { profile, useSite } from '../helpers/site-data';

vi.mock('../../src/lib/content', async () => {
  const { siteState } = await import('../helpers/site-data');
  return { getSiteData: async () => siteState.data };
});

const TITLE = '𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊';
const SLOGAN = 'Dis is da cyberspace of Lil’Horse, just chill and have fun 🍻.';

beforeEach(() => {
  useSite({
    profile: { ...profile, email: 'sup@lil.horse', github: 'lilhorse' },
    masthead: { title: TITLE, slogan: SLOGAN },
  });
});

describe('/profile/README.md', () => {
  it('is the card in Markdown, with the banner of the masthead title', async () => {
    const response = await readme({} as APIContext);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const markdown = await response.text();
    const banner = halfBlocks(bannerBitmap(TITLE, () => undefined)).join('\n');
    expect(markdown).toContain(`\`\`\`text\n${banner}\n\`\`\``);
    expect(markdown).toContain(`*${SLOGAN}*`);
    expect(markdown).toContain('[email](https://lil.horse/contact)');
    expect(markdown).not.toContain('sup@lil.horse');
  });
});

describe('/brand/horse-*.svg', () => {
  it('serves the two 24-grid horses from src/assets/brand', async () => {
    const names = getStaticPaths().map(({ params }) => params.name);
    expect(names).toEqual(['horse-chestnut', 'horse-night']);
    for (const name of names) {
      const response = await horse({ params: { name } } as unknown as APIContext);
      expect(response.headers.get('content-type')).toBe('image/svg+xml');
      expect(await response.text()).toBe(readFileSync(`src/assets/brand/${name}.svg`, 'utf8'));
    }
  });
});
