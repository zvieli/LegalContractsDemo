import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx,mjs}', 'src/**/__tests__/**/*.{js,jsx,mjs}', 'src/services/__tests__/**/*.{js,jsx,mjs}', 'src/**/?(*.)+(test|spec).{js,jsx,mjs}'],
    environment: 'jsdom'
  }
})
