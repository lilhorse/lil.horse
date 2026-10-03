import type { APIRoute, GetStaticPaths } from 'astro';
import { getSiteData } from '../../../lib/content';
import { ogTargets, type OgTarget } from '../../../lib/og';
import { renderOg } from '../../../og/render';

export const getStaticPaths = (async () => {
  const site = await getSiteData();
  return ogTargets(site).map((target) => ({
    params: { type: target.type, slug: target.slug },
    props: { target },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ target: OgTarget }> = async ({ props }) => {
  const png = await renderOg(props.target, (message) => console.warn(message));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
