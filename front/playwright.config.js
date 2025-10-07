import { defineConfig } from '@playwright/test';

// Ensure test runs are deterministic: prefer noble secp256k1 fallback and enable TESTING diagnostics
process.env.SUPPORT_NOBLE_SECP = process.env.SUPPORT_NOBLE_SECP || '1';
process.env.TESTING = process.env.TESTING || '1';
process.env.VITE_E2E_TESTING = 'true'; // Enable E2E mode

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.test.ts',
  timeout: 120_000, // Increased for MetaMask interactions
  expect: { timeout: 15000 },
  // run tests in a single worker to avoid per-worker beforeAll launching the dev server
  workers: 1,
  use: {
    baseURL: `http://localhost:${process.env.VITE_DEV_PORT || 5173}`,
    headless: false, // Non-headless for better Web3 simulation
    viewport: { width: 1280, height: 720 },
    actionTimeout: 20_000, // Increased for wallet interactions
    // Browser args for Web3 testing (without MetaMask extension)
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    }
  },
  projects: [
    { 
      name: 'chromium-web3-simulation', 
      use: { 
        browserName: 'chromium'
      } 
    }
  ],
});
