import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs';
import path from 'node:path';

// Vite middleware to serve ABI/deployment files from src/utils/contracts
function contractsMiddleware() {
  return {
    name: 'serve-contracts-json',
    configureServer(server) {
      server.middlewares.use('/utils/contracts', (req, res, next) => {
        const fileName = req.url.replace(/^\/utils\/contracts\//, '');
        const filePath = path.join(__dirname, 'src/utils/contracts', fileName);
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'application/json');
          fs.createReadStream(filePath).pipe(res);
        } else {
          next();
        }
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contractsMiddleware()],
  define: {
    global: 'window'
  },
  resolve: {
    alias: {
      buffer: 'buffer'
    }
  },
  optimizeDeps: {
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
    },
    fs: {
      allow: [
        path.resolve(__dirname, 'src'),
        path.resolve(__dirname, 'src/utils/contracts'),
        path.resolve(__dirname, 'src/config'),
        path.resolve(__dirname, 'config')
      ]
    }
  },
  // Removed configureServer from config object; now handled by contractsMiddleware plugin
})
