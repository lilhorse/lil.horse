import type { APIRoute } from 'astro';
import { siteConfig } from '../../../site.config';
import { bannerBitmap } from '../../lib/banner';
import { getSiteData } from '../../lib/content';
import { profileReadme } from '../../lib/profile-readme';

/** The GitHub profile README; scripts/sync-profile-readme.ts copies it to the profile repository. */
export const GET: APIRoute = async () => {
  const { masthead, profile } = await getSiteData();
  const banner = bannerBitmap(masthead.title, (message) => console.warn(message));
  return new Response(
    profileReadme({
      title: masthead.title,
      banner,
      slogan: masthead.slogan,
      profile,
      site: siteConfig.url,
    }),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  );
};
