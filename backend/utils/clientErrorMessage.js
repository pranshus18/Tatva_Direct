/**
 * Safe client-facing error text — hides internal details on 5xx in production.
 */
export function clientErrorMessage(error, fallback, statusCode = 500) {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && statusCode >= 500) {
    return fallback;
  }
  const message = String(error?.message || '').trim();
  return message || fallback;
}
