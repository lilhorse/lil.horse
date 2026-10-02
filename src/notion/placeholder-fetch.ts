import { createHash } from 'node:crypto';
import sharp from 'sharp';

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export const placeholderFetch: typeof fetch = async (input, init) => {
  const url = urlOf(input);
  const host = new URL(url).hostname;
  if ((new Headers(init?.headers).get('accept') ?? '').includes('text/html')) {
    const html = `<!doctype html><html><head><title>${host}</title><meta property="og:description" content="Offline placeholder for ${host}"></head><body></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const shade = Number.parseInt(createHash('sha256').update(url).digest('hex').slice(0, 6), 16);
  const png = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: (shade >> 16) & 255, g: (shade >> 8) & 255, b: shade & 255 },
    },
  })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
  });
};
