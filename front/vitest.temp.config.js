import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/services/__tests__/contractService.queue.test.js'],
    environment: 'jsdom',
    globals: true
  }
})
