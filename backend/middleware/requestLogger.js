import { isFeatureEnabled } from '../utils/featureFlags.js';
import logger from '../utils/logger.js';

export function requestLogger(req, res, next) {
  if (process.env.NODE_ENV !== 'production' || isFeatureEnabled('REQUEST_LOGS_ENABLED', false)) {
    logger.info(`[${new Date().toISOString()}] [${req.requestId}] ${req.method} ${req.originalUrl}`);
  }
  next();
}
