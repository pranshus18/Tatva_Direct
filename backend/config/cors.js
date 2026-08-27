/**
 * CORS options for Express. Kept separate so server bootstrap and tests can reuse the same policy.
 */
export function createCorsOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  const defaultOrigins = [
    'https://project-frontend-git-main-pranshus-projects-2ecfd5c2.vercel.app',
    'https://direct.withtatva.ai',
    'https://www.direct.withtatva.ai',
    'https://tatva-direct-frontend-five.vercel.app',
    'https://tatvadirect.onrender.com',
    'https://tatva-direct.vercel.app',
    'https://tatva-direct.netlify.app',
    'https://*.vercel.app',
    'https://*.netlify.app'
  ];

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (!isProduction) {
        return callback(null, true);
      }

      // Merge env allowlist with defaults so Render ALLOWED_ORIGINS does not drop known frontends.
      const fromEnv = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
        : [];
      const allowedOrigins = [...new Set([...defaultOrigins, ...fromEnv])];

      const normalizedOrigin = String(origin).replace(/\/$/, '');
      const normalizedAllowedOrigins = allowedOrigins.map((o) => String(o).replace(/\/$/, ''));

      const isAllowed = normalizedAllowedOrigins.some((allowedOrigin) => {
        if (allowedOrigin === normalizedOrigin) {
          return true;
        }

        if (allowedOrigin.includes('*')) {
          // Escape regex specials except `*`, then turn `*` into `.*`
          const wildcardRegex = new RegExp(
            `^${allowedOrigin
              .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')}$`
          );
          return wildcardRegex.test(normalizedOrigin);
        }

        return false;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        // Reject without throwing — throwing becomes HTTP 500 and hides the real CORS cause.
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'Pragma',
      'X-Request-ID',
      'X-PM-Access-Token',
      'X-PM-Refresh-Token',
      // Sent by vault reconciliation to overlay Tatva Direct platform attribution.
      'X-Vault-Attribution-Keys'
    ]
  };
}
