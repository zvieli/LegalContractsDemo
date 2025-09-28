import { defineConfig } from '@playwright/test';

// Ensure test runs are deterministic: prefer noble secp256k1 fallback and enable TESTING diagnostics
process.env.SUPPORT_NOBLE_SECP = process.env.SUPPORT_NOBLE_SECP || '1';
process.env.TESTING = process.env.TESTING || '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5000 },
  use: {
    baseURL: `http://localhost:${process.env.VITE_DEV_PORT || 5173}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
