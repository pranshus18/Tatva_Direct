/**
 * Load environment variables before other modules read process.env.
 * Import this file first from server.js (side effects only).
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = join(__dirname, '..');

dotenv.config({ path: join(backendRoot, '.env') });
dotenv.config({ path: join(backendRoot, 'env.local') });
dotenv.config({ path: join(backendRoot, '..', '.env') });
dotenv.config({ path: join(backendRoot, '..', 'env.local') });
