import rateLimit from 'express-rate-limit';
import { isFeatureEnabled } from '../utils/featureFlags.js';

function disabled() {
  return isFeatureEnabled('RATE_LIMIT_DISABLED', false) || process.env.NODE_ENV === 'test';
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Stricter limits for /api/auth/* (login, signup, password flows).
 * Tune with RATE_LIMIT_AUTH_WINDOW_MS and RATE_LIMIT_AUTH_MAX.
 */
export const authRateLimiter = rateLimit({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_AUTH_MAX, 40),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabled(),
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      status: 'error',
      message: 'Too many authentication attempts from this network. Please try again later.',
      requestId: req.requestId
    });
  }
});

/**
 * Webhooks are called by providers (e.g. Razorpay); use a high ceiling to block only abuse.
 */
export const paymentsWebhookRateLimiter = rateLimit({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS, 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_WEBHOOK_MAX, 500),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabled(),
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      status: 'error',
      message: 'Too many webhook requests',
      requestId: req.requestId
    });
  }
});
