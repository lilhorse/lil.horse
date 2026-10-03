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
  {
    files: ['src/notion/**', 'src/env.ts', 'integrations/**', 'scripts/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.meta.name='import']:matches([property.name='env'], [property.value='env'])",
          message:
            'Vite inlines every env var into build output, the Notion token included. Read process.env instead.',
        },
      ],
    },
  },
  // src/notion is a self-contained Notion reader; only the Astro adapter loaders.ts may reach into the site.
  {
    files: ['src/notion/**/*.ts'],
    ignores: ['src/notion/loaders.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./',
              message:
                'src/notion must not import site code; pass what it needs in as options or move the code out.',
            },
            {
              regex: '^astro:',
              message: 'Only src/notion/loaders.ts talks to Astro.',
            },
          ],
        },
      ],
    },
  },
  { languageOptions: { globals: { ...globals.node } } },
]);
