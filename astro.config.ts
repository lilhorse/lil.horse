import { defineConfig, fontProviders } from 'astro/config';
import expressiveCode from 'astro-expressive-code';
import { staticAssets } from './integrations/static-assets';

const LATIN = [
  'U+0000-00FF',
  'U+0131',
  'U+0152-0153',
  'U+02BB-02BC',
  'U+02C6',
  'U+02DA',
  'U+02DC',
  'U+0304',
  'U+0308',
  'U+0329',
  'U+2000-206F',
  'U+20AC',
  'U+2122',
  'U+2191',
  'U+2193',
  'U+2212',
  'U+2215',
  'U+FEFF',
  'U+FFFD',
] as [string, ...string[]];

const mono = (weight: number, style: 'normal' | 'italic' = 'normal') => ({
  weight,
  style,
  src: [`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${weight}-${style}.woff2`] as [
    string,
  ],
});
const sans = (weight: number, style: 'normal' | 'italic' = 'normal') => ({
  weight,
  style,
  src: [`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-${style}.woff2`] as [string],
});

export default defineConfig({
  site: 'https://lil.horse',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains-mono',
      fallbacks: [
        'ui-monospace',
        'SFMono-Regular',
        'Menlo',
        'Consolas',
        'PingFang SC',
        'Microsoft YaHei',
        'monospace',
      ],
      unicodeRange: LATIN,
      options: { variants: [mono(400), mono(400, 'italic'), mono(600), mono(700)] },
    },
    {
      provider: fontProviders.local(),
      name: 'IBM Plex Sans',
      cssVariable: '--font-ibm-plex-sans',
      fallbacks: [
        'system-ui',
        '-apple-system',
        'Segoe UI',
        'PingFang SC',
        'Hiragino Sans GB',
        'Noto Sans CJK SC',
        'Microsoft YaHei',
        'sans-serif',
      ],
      unicodeRange: LATIN,
      options: { variants: [sans(400), sans(400, 'italic'), sans(500), sans(600)] },
    },
  ],
  integrations: [expressiveCode(), staticAssets()],
});
