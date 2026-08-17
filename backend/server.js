import './bootstrap/loadEnv.js';

import { testConnection } from './config/supabase.js';
import { registerProcessSafety } from './middleware/processSafety.js';
import { validateProductionEnv } from './config/validateEnv.js';
import { isFeatureEnabled } from './utils/featureFlags.js';
import { attachVoiceWebSocket } from './voice/voiceWebSocket.js';
import { warmSupportIndex } from './voice/supportRetriever.js';
import logger from './utils/logger.js';
import { createApp } from './app/createApp.js';
import { setupGracefulShutdown } from './app/gracefulShutdown.js';
import { expireStaleReservations } from './services/checkoutInventoryReservationService.js';
import { PM_API_ENV, PM_API_BASE_URL, PM_PAYMENT_API_BASE_URL } from './config/pmApi.js';

registerProcessSafety();
validateProductionEnv();

const showEnvDiagnostics = process.env.NODE_ENV !== 'production' || isFeatureEnabled('LOG_ENV_STARTUP', false);
if (showEnvDiagnostics) {
  logger.info('Environment Variables Status:');
  logger.info(`  JWT_SECRET: ${process.env.JWT_SECRET ? 'Set' : 'Not set'}`);
  logger.info(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'Set' : 'Not set'}`);
  logger.info(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Set' : 'Not set'}`);
  logger.info(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'Set' : 'Not set'}`);
  logger.info(`  SUPABASE_URL: ${process.env.SUPABASE_URL ? 'Set' : 'Not set'}`);
  logger.info(`  SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'Set' : 'Not set'}`);
  logger.info(`  SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Not set'}`);
  logger.info(`  ADMIN_EMAIL: ${process.env.ADMIN_EMAIL ? 'Set' : 'Not set'}`);
  logger.info(`  ADMIN_PASSWORD: ${process.env.ADMIN_PASSWORD ? 'Set' : 'Not set'}`);
}

testConnection().catch((err) => {
  logger.error('Supabase connection failed:', err.message);
  logger.error('Please ensure:');
  logger.error('  1. SUPABASE_URL is set in .env');
  logger.error('  2. SUPABASE_SERVICE_ROLE_KEY is set in .env');
  logger.error('  3. Schema has been created (run backend/sql/schema.sql in Supabase SQL Editor)');
  process.exit(1);
});

const app = createApp();

const port = process.env.PORT || 8081;
const HOST = '0.0.0.0';

logger.info('Starting server...');
logger.info(` Host: ${HOST}`);
logger.info(` Port: ${port}`);
logger.info(` Environment: ${process.env.NODE_ENV}`);
logger.info(` PM APIs: ${PM_API_ENV} (${PM_API_BASE_URL} | ${PM_PAYMENT_API_BASE_URL})`);
logger.info(`  Supabase: ${process.env.SUPABASE_URL ? 'Configured' : 'Not configured'}`);

const server = app.listen(port, HOST, () => {
  logger.info(` Server successfully running on http://${HOST}:${port}`);
  logger.info(` Health check: http://${HOST}:${port}/api/health`);
  logger.info(` Voice WebSocket: ws://${HOST}:${port}/api/voice/ws`);
  logger.info(` API docs: http://${HOST}:${port}/`);
  logger.info(' Server is ready to accept connections');
});

attachVoiceWebSocket(server);
const ragChunks = warmSupportIndex();
if (ragChunks > 0) {
  logger.info(`[voice] RAG index warmed (${ragChunks} chunks)`);
}

server.on('error', (err) => {
  logger.error(' Server failed to start:', err);
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${port} is already in use`);
  }
  process.exit(1);
});

setupGracefulShutdown(server);

const reservationSweepMinutes = Math.max(
  1,
  parseInt(String(process.env.CHECKOUT_RESERVATION_SWEEP_MINUTES ?? '1').trim(), 10) || 1
);
const reservationSweepMs = reservationSweepMinutes * 60 * 1000;
const runReservationSweep = () => {
  expireStaleReservations().catch((err) => {
    logger.error('[Reservations] Expire sweep failed:', err?.message || err);
  });
};
runReservationSweep();
setInterval(runReservationSweep, reservationSweepMs);
logger.info(`[Reservations] Expire sweep every ${reservationSweepMinutes} minute(s)`);
