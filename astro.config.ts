import { defineConfig } from 'astro/config';
import expressiveCode from 'astro-expressive-code';

export default defineConfig({
  site: 'https://lil.horse',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [expressiveCode()],
});
