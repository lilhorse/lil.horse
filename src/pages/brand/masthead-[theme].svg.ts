import type { APIRoute, GetStaticPaths } from 'astro';
import { bannerBitmap, bannerSvg, type BannerTheme } from '../../lib/banner';
import { getSiteData } from '../../lib/content';

const THEMES: BannerTheme[] = ['dark', 'light'];

// The profile README shows these from lil.horse.
export const getStaticPaths = (() =>
  THEMES.map((theme) => ({ params: { theme } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const { masthead } = await getSiteData();
  const theme = THEMES.find((name) => name === params.theme) ?? 'light';
  const banner = bannerBitmap(masthead.title, (message) => console.warn(message));
  return new Response(bannerSvg(banner, masthead.title, theme), {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
};
