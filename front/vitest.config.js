import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx,mjs,ts,tsx}', 'src/**/__tests__/**/*.{js,jsx,mjs,ts,tsx}', 'src/services/__tests__/**/*.{js,jsx,mjs,ts,tsx}', 'src/**/?(*.)+(test|spec).{js,jsx,mjs,ts,tsx}', 'tests/**/*.{test,spec}.{js,jsx,mjs,ts,tsx}'],
    environment: 'jsdom'
  }
})
