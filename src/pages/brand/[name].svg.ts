import type { APIRoute, GetStaticPaths } from 'astro';
import { HORSE_NAMES, servedHorse } from '../../lib/brand-horses';

// The profile README shows these from lil.horse.
export const getStaticPaths = (() =>
  HORSE_NAMES.map((name) => ({ params: { name } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const name = HORSE_NAMES.find((horse) => horse === params.name) ?? 'horse-chestnut';
  return new Response(servedHorse(name), { headers: { 'Content-Type': 'image/svg+xml' } });
};
