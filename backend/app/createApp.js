import express from 'express';
import cors from 'cors';
import { paymentsWebhookRouter } from '../routes/payments.js';
import { apiRouter } from '../routes/api.js';
import { paymentsWebhookRateLimiter } from '../middleware/rateLimits.js';
import { requestContext } from '../middleware/requestContext.js';
import { requestLogger } from '../middleware/requestLogger.js';
import { noApiCache } from '../middleware/cacheControl.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import { getApiInfo } from '../controllers/systemController.js';
import { createCorsOptions } from '../config/cors.js';
import { parseBooleanEnv } from '../utils/featureFlags.js';

/**
 * Build the Express application (middleware + routes) without listening.
 * Keeps server.js focused on process lifecycle and allows integration tests to mount the same app.
 */
export function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  if (parseBooleanEnv('TRUST_PROXY', isProduction)) {
    app.set('trust proxy', 1);
  }

  app.use(cors(createCorsOptions()));

  app.use(requestContext);
  app.use(requestLogger);

  app.use(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    paymentsWebhookRateLimiter,
    paymentsWebhookRouter
  );

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.use('/api', noApiCache);

  app.get('/', getApiInfo);
  app.use('/api', apiRouter);

  app.use(globalErrorHandler);

  app.all('*', (req, res) => {
    res.status(404).json({
      status: 'error',
      message: `Route ${req.originalUrl} not found`
    });
  });

  return app;
}
