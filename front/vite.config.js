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
    // Keep common crypto/browser libs pre-bundled. Do NOT force `eth-crypto`
    // into the prebundle; encryption helpers are admin-only and should not be
    // included in the main client bundle unless intentionally enabled.
    include: ['buffer', 'bn.js', 'elliptic', 'secp256k1', 'eccrypto']
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
  },
  server: {
    // Dev proxy to forward evidence endpoint requests to the backend running locally
    proxy: {
      '/submit-evidence': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false
      },
      '/ping': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
