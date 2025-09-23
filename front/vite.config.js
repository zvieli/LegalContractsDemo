import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // some node libs expect `global` to exist
    global: 'window'
  },
  resolve: {
    alias: {
      // ensure the browser buffer package is used
      buffer: 'buffer'
    }
  },
  optimizeDeps: {
    include: ['buffer', 'bn.js', 'elliptic', 'secp256k1', 'eccrypto', 'eth-crypto']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('/src/utils/contracts') || id.includes('/src/contracts') || id.includes('TemplateRentContractABI')) {
            return 'contracts';
          }
        }
      }
    }
  }
})
