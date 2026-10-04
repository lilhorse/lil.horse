import type { RuntimeEnv } from '../env';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** The beacon token for this build; fixture builds are tests and never report visits. */
export function beaconToken(token: string, env: Pick<RuntimeEnv, 'fixtures'>): string | null {
  return token && !env.fixtures ? token : null;
}

/** Inline script that adds the beacon; a prerendered page waits until it is shown, so a hovered link is not a visit. */
export function beaconLoader(token: string): string {
  const config = JSON.stringify(JSON.stringify({ token })).replace(/</g, '\\u003c');
  return [
    '{const load=()=>{const s=document.createElement("script");',
    `s.src=${JSON.stringify(BEACON_SRC)};s.setAttribute("data-cf-beacon",${config});document.body.append(s)};`,
    'if(document.prerendering)document.addEventListener("prerenderingchange",load,{once:true});else load()}',
  ].join('');
}
