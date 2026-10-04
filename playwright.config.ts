import { defineConfig, devices } from '@playwright/test';

// Worktrees that run e2e at the same time each need their own port.
const PORT = Number(process.env.E2E_PORT || 4322);
const DESKTOP = { width: 1280, height: 800 };
const ENGINE_CHECKS = /browsers\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 } },
  webServer: {
    command: `tsx scripts/serve-dist.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: DESKTOP } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'webkit',
      testMatch: ENGINE_CHECKS,
      use: { ...devices['Desktop Safari'], viewport: DESKTOP },
    },
    {
      name: 'firefox',
      testMatch: ENGINE_CHECKS,
      use: { ...devices['Desktop Firefox'], viewport: DESKTOP },
    },
  ],
});
