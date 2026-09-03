import rateLimit from 'express-rate-limit';
import { isFeatureEnabled } from '../utils/featureFlags.js';

const AUTH_CREDENTIAL_PATHS = new Set([
  '/login',
  '/signup',
  '/pm-send-otp',
  '/pm-verify-otp',
  '/pm-otp-login',
  '/pm-signup'
]);

function disabled() {
  return isFeatureEnabled('RATE_LIMIT_DISABLED', false) || process.env.NODE_ENV === 'test';
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeAuthPath(value) {
  const path = String(value || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const authIndex = path.lastIndexOf('/auth/');
  if (authIndex >= 0) {
    return path.slice(authIndex + '/auth'.length) || '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Login/signup/OTP only. Session routes (portal-status, switch-portal, vault-session)
 * run on a normal page and must not share this brute-force bucket.
 */
export function isAuthCredentialRequest(req) {
  const fromOriginal = normalizeAuthPath(req?.originalUrl);
  if (AUTH_CREDENTIAL_PATHS.has(fromOriginal)) return true;
  return AUTH_CREDENTIAL_PATHS.has(normalizeAuthPath(req?.path || req?.url));
}

function skipAuthRateLimit(req) {
  return disabled() || !isAuthCredentialRequest(req);
}

/**
 * Stricter limits for login, signup, and OTP flows.
 * Tune with RATE_LIMIT_AUTH_WINDOW_MS and RATE_LIMIT_AUTH_MAX.
 */
export const authRateLimiter = rateLimit({
  windowMs: parsePositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
  max: parsePositiveInt(process.env.RATE_LIMIT_AUTH_MAX, 40),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAuthRateLimit,
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
