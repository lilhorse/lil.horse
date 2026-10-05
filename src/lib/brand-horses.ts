import chestnut from '../assets/brand/horse-chestnut.svg?raw';
import night from '../assets/brand/horse-night.svg?raw';

const HORSES = { 'horse-chestnut': chestnut, 'horse-night': night };
export type HorseName = keyof typeof HORSES;
export const HORSE_NAMES = Object.keys(HORSES) as HorseName[];

// Keep in step with the glint in PixelHorse.astro; a test compares the two.
const GLINT =
  '.horse-glint{animation:horse-glint 3s steps(1) infinite}' +
  '@keyframes horse-glint{0%,70%,78%,100%{opacity:1}72%,76%{opacity:0}74%{opacity:1}}' +
  '@media (prefers-reduced-motion:reduce){.horse-glint{animation:none}}';

/** A 24-grid horse as lil.horse serves it to the profile README, its sunglasses glinting like the site's. */
export function servedHorse(name: HorseName): string {
  return HORSES[name].replace(/^<svg[^>]*>/, (open) => `${open}<style>${GLINT}</style>`);
}
