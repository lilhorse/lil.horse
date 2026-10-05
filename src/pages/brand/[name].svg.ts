import type { APIRoute, GetStaticPaths } from 'astro';
import chestnut from '../../assets/brand/horse-chestnut.svg?raw';
import night from '../../assets/brand/horse-night.svg?raw';

// The profile README shows these from lil.horse.
const HORSES: Record<string, string> = { 'horse-chestnut': chestnut, 'horse-night': night };

export const getStaticPaths = (() =>
  Object.keys(HORSES).map((name) => ({ params: { name } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(HORSES[params.name ?? ''], { headers: { 'Content-Type': 'image/svg+xml' } });
