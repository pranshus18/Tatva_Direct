import logger from '../utils/logger.js';

const REQUIRED_IN_PRODUCTION = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

/**
 * Fail fast when critical secrets are missing in production.
 */
export function validateProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length === 0) return;

  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
