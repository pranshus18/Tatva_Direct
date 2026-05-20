/**
 * CORS options for Express. Kept separate so server bootstrap and tests can reuse the same policy.
 */
export function createCorsOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (!isProduction) {
        return callback(null, true);
      }

      const defaultOrigins = [
        'https://project-frontend-git-main-pranshus-projects-2ecfd5c2.vercel.app',
        'https://tatvadirect.onrender.com',
        'https://tatva-direct.vercel.app',
        'https://tatva-direct.netlify.app',
        'https://*.vercel.app'
      ];

      const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
        : defaultOrigins;

      const normalizedOrigin = String(origin).replace(/\/$/, '');
      const normalizedAllowedOrigins = allowedOrigins.map((o) => String(o).replace(/\/$/, ''));

      const isAllowed = normalizedAllowedOrigins.some((allowedOrigin) => {
        if (allowedOrigin === normalizedOrigin) {
          return true;
        }

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
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'X-Request-ID']
  };
}
