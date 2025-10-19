import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only run frontend unit tests under src/ and avoid Playwright e2e test files in tests/
    include: ['src/**/*.{test,spec}.{js,jsx,mjs,ts,tsx}', 'src/**/__tests__/**/*.{js,jsx,mjs,ts,tsx}', 'src/services/__tests__/**/*.{js,jsx,mjs,ts,tsx}', 'src/**/?(*.)+(test|spec).{js,jsx,mjs,ts,tsx}'],
    environment: 'jsdom'
  }
})
