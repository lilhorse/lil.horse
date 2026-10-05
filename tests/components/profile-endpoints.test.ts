import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bannerBitmap, bannerImageSize, bannerSvg } from '../../src/lib/banner';
import { GET as horse, getStaticPaths } from '../../src/pages/brand/[name].svg';
import {
  GET as masthead,
  getStaticPaths as mastheadPaths,
} from '../../src/pages/brand/masthead-[theme].svg';
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
    const { width } = bannerImageSize(bannerBitmap(TITLE, () => undefined));
    expect(markdown).toContain(
      `<img alt="Lil’Horse" width="${width}" src="https://lil.horse/brand/masthead-light.svg?v=`,
    );
    expect(markdown).toContain(`*${SLOGAN}*`);
    expect(markdown).toContain('[email](https://lil.horse/contact)');
    expect(markdown).not.toContain('sup@lil.horse');
  });
});

describe('/profile/README.md and /brand/masthead-*.svg', () => {
  it('version the banner URLs by the SHA-256 of the files the site serves', async () => {
    const markdown = await (await readme({} as APIContext)).text();
    for (const theme of ['dark', 'light']) {
      const response = await masthead({ params: { theme } } as unknown as APIContext);
      const version = createHash('sha256')
        .update(await response.text())
        .digest('hex')
        .slice(0, 8);
      expect(markdown).toContain(`https://lil.horse/brand/masthead-${theme}.svg?v=${version}"`);
    }
  });
});

describe('/brand/masthead-*.svg', () => {
  const themes = () => mastheadPaths().map(({ params }) => params.theme);
  const svg = async (theme: string) => {
    const response = await masthead({ params: { theme } } as unknown as APIContext);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    return response.text();
  };

  it('serves the banner in each theme', async () => {
    expect(themes()).toEqual(['dark', 'light']);
    const banner = bannerBitmap(TITLE, () => undefined);
    expect(await svg('dark')).toBe(bannerSvg(banner, TITLE, 'dark'));
    expect(await svg('light')).toBe(bannerSvg(banner, TITLE, 'light'));
  });

  it('serves an empty image when the font can draw none of the title', async () => {
    useSite({ masthead: { title: '小马', slogan: null } });
    for (const theme of themes()) {
      const image = await svg(theme);
      expect(image).toContain('<title>小马</title>');
      expect(image).not.toContain('<path');
    }
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
