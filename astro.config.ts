import { defineConfig } from 'astro/config';
import expressiveCode from 'astro-expressive-code';
import { staticAssets } from './integrations/static-assets';

export default defineConfig({
  site: 'https://lil.horse',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [expressiveCode(), staticAssets()],
});
