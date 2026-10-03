import { getViteConfig } from 'astro/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      // The dev toolbar would add data-astro-source-* attributes to every element.
      getViteConfig(
        { test: { name: 'components', include: ['tests/components/**/*.test.ts'] } },
        { devToolbar: { enabled: false } },
      ),
    ],
  },
});
