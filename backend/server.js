import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './config/supabase.js';
import { paymentsWebhookRouter } from './routes/payments.js';
import { apiRouter } from './routes/api.js';
import { requestContext } from './middleware/requestContext.js';
import { requestLogger } from './middleware/requestLogger.js';
import { noApiCache } from './middleware/cacheControl.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import { getApiInfo } from './controllers/systemController.js';
import logger from './utils/logger.js';
import { isFeatureEnabled } from './utils/featureFlags.js';
import { attachVoiceWebSocket } from './voice/voiceWebSocket.js';
import { warmSupportIndex } from './voice/supportRetriever.js';

// Load environment variables
// Try to load from backend directory first, then root directory
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
const envPath = join(__dirname, '.env');
dotenv.config({ path: envPath });

// Also try env.local in backend directory
const envLocalPath = join(__dirname, 'env.local');
dotenv.config({ path: envLocalPath });

// Also try root directory as fallback
const rootEnvPath = join(__dirname, '..', '.env');
dotenv.config({ path: rootEnvPath });

// Also try root env.local
const rootEnvLocalPath = join(__dirname, '..', 'env.local');
dotenv.config({ path: rootEnvLocalPath });

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

// Connect to Supabase
testConnection().catch((err) => {
  logger.error('Supabase connection failed:', err.message);
  logger.error('Please ensure:');
  logger.error('  1. SUPABASE_URL is set in .env');
  logger.error('  2. SUPABASE_SERVICE_ROLE_KEY is set in .env');
  logger.error('  3. Schema has been created (run backend/sql/schema.sql in Supabase SQL Editor)');
  process.exit(1);
});

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

// CORS Configuration - Environment-based
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (!isProduction) {
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    const defaultOrigins = [
      'https://project-frontend-git-main-pranshus-projects-2ecfd5c2.vercel.app',
      'https://tatvadirect.onrender.com',
      'https://tatva-direct.vercel.app',
      'https://tatva-direct.netlify.app',
      'https://*.vercel.app'
    ];
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : defaultOrigins;
    
    const normalizedOrigin = String(origin).replace(/\/$/, '');
    const normalizedAllowedOrigins = allowedOrigins.map((o) => String(o).replace(/\/$/, ''));
    const isAllowed = normalizedAllowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin === normalizedOrigin) {
        return true;
      }

      // Support wildcard patterns such as https://*.vercel.app in env config.
      if (allowedOrigin.includes('*')) {
        const wildcardRegex = new RegExp(
          `^${allowedOrigin
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\*/g, '.*')}$`
        );
        return wildcardRegex.test(normalizedOrigin);
      }

      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'X-Request-ID'
  ]
};

app.use(cors(corsOptions));

// Razorpay webhook requires raw body for signature verification.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentsWebhookRouter);

// Simple request logger to see incoming API calls
app.use(requestContext);
app.use(requestLogger);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Force fresh data for API reads so clients always receive latest state.
app.use('/api', noApiCache);

// Routes
app.get('/', getApiInfo);
app.use('/api', apiRouter);

app.use(globalErrorHandler);

// Handle 404 routes
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

const port = process.env.PORT || 8081;
const HOST = '0.0.0.0';

logger.info('Starting server...');
logger.info(` Host: ${HOST}`);
logger.info(` Port: ${port}`);
logger.info(` Environment: ${process.env.NODE_ENV}`);
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

let isShuttingDown = false;
let forceCloseTimer = null;

function shutdown(signal) {
  if (isShuttingDown) {
    logger.info(` ${signal} received again, forcing exit`);
    process.exit(1);
    return;
  }
  isShuttingDown = true;
  logger.info(` ${signal} received, shutting down gracefully`);

  // Do not hang forever on open keep-alive sockets.
  forceCloseTimer = setTimeout(() => {
    logger.warn(' Force exiting: graceful shutdown timed out');
    process.exit(1);
  }, 5000);

  server.close(() => {
    if (forceCloseTimer) clearTimeout(forceCloseTimer);
    logger.info(' Server closed');
    logger.info(' Supabase connection closed');
    process.exit(0);
  });

  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
}

const shutdownHandlers = globalThis.__tatvaShutdownHandlers || {};
if (shutdownHandlers.sigint) process.removeListener('SIGINT', shutdownHandlers.sigint);
if (shutdownHandlers.sigterm) process.removeListener('SIGTERM', shutdownHandlers.sigterm);

const handleSigint = () => shutdown('SIGINT');
const handleSigterm = () => shutdown('SIGTERM');
process.on('SIGINT', handleSigint);
process.on('SIGTERM', handleSigterm);
globalThis.__tatvaShutdownHandlers = { sigint: handleSigint, sigterm: handleSigterm };