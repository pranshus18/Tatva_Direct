/**
 * Load environment variables before other modules read process.env.
 * Import this file first from server.js (side effects only).
 *
 * Development: loads backend/.env (and env.local overrides) with override: true
 * so file values win over stale shell exports.
 *
 * Production: skips dotenv entirely — use host/platform env vars only (Render, etc.).
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

if (process.env.NODE_ENV === 'production') {
  // Do not read .env files in production; secrets come from the deploy environment.
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const backendRoot = join(__dirname, '..');
  const dotenvOptions = { override: true };

  dotenv.config({ path: join(backendRoot, '.env'), ...dotenvOptions });
  dotenv.config({ path: join(backendRoot, 'env.local'), ...dotenvOptions });
  dotenv.config({ path: join(backendRoot, '..', '.env'), ...dotenvOptions });
  dotenv.config({ path: join(backendRoot, '..', 'env.local'), ...dotenvOptions });
}
