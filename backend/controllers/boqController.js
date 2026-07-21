/**
 * BOQ controller — normalization helpers stay in boqCore; HTTP routes in ./boq/*.
 */
import express from 'express';
import multer from 'multer';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import * as boqCore from './boq/boqCore.js';
import { registerBoqNormalizeRoutes } from './boq/normalizeRoutes.js';
import { registerBoqRequestProductRoutes } from './boq/requestProductRoutes.js';
import { registerBoqCrudRoutes } from './boq/boqCrudRoutes.js';

const router = express.Router();
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB BOQ uploads
  }
});

const ctx = {
  router,
  authenticateToken,
  isServiceProvider,
  supabase,
  upload,
  ...boqCore
};

registerBoqNormalizeRoutes(ctx);
registerBoqRequestProductRoutes(ctx);
registerBoqCrudRoutes(ctx);

export { router as boqRouter };
