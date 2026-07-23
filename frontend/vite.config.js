import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3000,
    proxy: {
      // Voice WebSocket only — do not set ws:true on all /api (breaks Vite HMR → ECONNRESET).
      '/api/voice': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
        secure: false,
        ws: true
      },
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
        secure: false,
        timeout: 300000,
        proxyTimeout: 300000
      },
      // PM platform vault (dev CORS bypass — browser calls same-origin /pm-users/*)
      '/pm-users': {
        target: 'https://devopsapi.withtatva.ai/users',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/pm-users/, '')
      },
      '/pm-payment-initiate': {
        target: 'https://devopsapi.withtatva.ai/payment',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/pm-payment-initiate/, '')
      },
      '/pm-payment-complete': {
        // Prefer devops host — api.withtatva.ai often fails DNS (ENOTFOUND).
        // Backend also falls back to devopsapi for topup/complete.
        target: 'https://devopsapi.withtatva.ai/payment',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/pm-payment-complete/, '')
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react']
        }
      }
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setupTests.js',
    globals: true
  }
});
