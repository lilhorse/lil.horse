import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      'dist/',
      '.astro/',
      '.cache/',
      'node_modules/',
      'public/_media/',
      'tests/fixtures/',
      'test-results/',
      'playwright-report/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  astro.configs.recommended,
  // astro check already reports undefined names; core no-undef misfires on ambient types such as ImageMetadata.
  { files: ['**/*.astro'], rules: { 'no-undef': 'off' } },
  { languageOptions: { globals: { ...globals.node } } },
]);
