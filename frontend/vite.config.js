import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PM_USERS_HOST_BY_ENV = {
  development: 'https://devopsapi.withtatva.ai/users',
  production: 'https://opsapi.withtatva.ai/users'
};

const PM_PAYMENT_HOST_BY_ENV = {
  development: 'https://devopsapi.withtatva.ai/payment',
  production: 'https://opsapi.withtatva.ai/payment'
};

function resolvePmApiEnv(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  return 'development';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const pmEnv = resolvePmApiEnv(env.VITE_PM_API_ENV || env.PM_API_ENV || mode);
  const pmUsersHost = env.VITE_PM_AUTH_BASE_URL || PM_USERS_HOST_BY_ENV[pmEnv];
  const pmPaymentHost = env.VITE_PM_PAYMENT_BASE_URL || PM_PAYMENT_HOST_BY_ENV[pmEnv];
  const pmPaymentCompleteHost =
    env.VITE_PM_PAYMENT_COMPLETE_BASE_URL || pmPaymentHost;

  return {
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
        // PM platform (dev CORS bypass — browser calls same-origin /pm-users/*)
        '/pm-users': {
          target: pmUsersHost,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/pm-users/, '')
        },
        '/pm-payment-initiate': {
          target: pmPaymentHost,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/pm-payment-initiate/, '')
        },
        '/pm-payment-complete': {
          target: pmPaymentCompleteHost,
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
  };
});
