import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  use: {
    baseURL: `http://localhost:${process.env.VITE_DEV_PORT || 5174}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5000,
  },
  webServer: {
    // Use a tiny local static server to avoid building the full frontend during E2E smoke runs
    command: 'node ./serve-static.mjs',
    cwd: './',
    url: `http://localhost:${process.env.VITE_DEV_PORT || 5174}`,
    timeout: 120000,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
