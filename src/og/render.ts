import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { OG_SIZE, stripEmoji, type OgTarget } from '../lib/og';
import { loadFonts } from './fonts';
import { ogTree } from './template';

type SatoriElement = Parameters<typeof satori>[0];

export async function renderOg(target: OgTarget, warn: (message: string) => void): Promise<Buffer> {
  const fonts = await loadFonts();
  const svg = await satori(
    ogTree({ ...target, title: stripEmoji(target.title) || target.slug }) as SatoriElement,
    {
      ...OG_SIZE,
      fonts,
      loadAdditionalAsset: async (code, segment) => {
        warn(`Share image "${target.title}": no font covers "${segment}" (${code})`);
        return [];
      },
    },
  );
  // Satori has already turned every glyph into paths, so a system font scan would only cost time.
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}
