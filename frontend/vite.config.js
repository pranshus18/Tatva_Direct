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

function resolvePmApiEnv(raw, mode) {
  const explicit = String(raw || '').trim().toLowerCase();
  const viteMode = String(mode || '').trim().toLowerCase();
  if (viteMode === 'production' || viteMode === 'prod') return 'production';
  if (explicit === 'production' || explicit === 'prod') return 'production';
  return 'development';
}

function remapPmUrlToEnv(url, pmEnv) {
  const value = String(url || '').trim().replace(/\/$/, '');
  if (!value) return value;
  const targetHost = pmEnv === 'production' ? 'opsapi.withtatva.ai' : 'devopsapi.withtatva.ai';
  const otherHost = pmEnv === 'production' ? 'devopsapi.withtatva.ai' : 'opsapi.withtatva.ai';
  if (!value.includes(otherHost)) return value;
  return value.split(otherHost).join(targetHost);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const pmEnv = resolvePmApiEnv(env.VITE_PM_API_ENV || env.PM_API_ENV, mode);
  const pmUsersHost = remapPmUrlToEnv(
    env.VITE_PM_AUTH_BASE_URL || PM_USERS_HOST_BY_ENV[pmEnv],
    pmEnv
  );
  const pmPaymentHost = remapPmUrlToEnv(
    env.VITE_PM_PAYMENT_BASE_URL || PM_PAYMENT_HOST_BY_ENV[pmEnv],
    pmEnv
  );
  const pmPaymentCompleteHost = remapPmUrlToEnv(
    env.VITE_PM_PAYMENT_COMPLETE_BASE_URL || pmPaymentHost,
    pmEnv
  );

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
