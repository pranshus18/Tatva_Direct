import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import db from '../services/db.js';
import logger from '../utils/logger.js';
import { requireAdminPrivileges } from '../middleware/adminMiddleware.js';
import { fetchClosedReturnQuantityByOrderItem, getNetItemMetrics } from '../utils/netRevenue.js';
import { registerAdminAiEnhanceRoutes } from './admin/adminAiEnhanceRoutes.js';
import { registerProductWorkflowRoutes } from './admin/productWorkflowRoutes.js';
import { registerAdminNotificationRoutes } from './admin/notificationRoutes.js';
import { registerAdminBrandAndSupplyChainRoutes } from './admin/brandAndSupplyChainRoutes.js';
import { registerAdminPlatformOpsRoutes } from './admin/platformOpsRoutes.js';
import { registerAdminUserManagementRoutes } from './admin/userManagementRoutes.js';
import { registerAdminProductModerationRoutes } from './admin/productModerationRoutes.js';
import { registerAdminProductCatalogRoutes } from './admin/productCatalogRoutes.js';
import { generateAdminData } from './admin/adminDataService.js';

const router = express.Router();
const console = {
  log: (...args) => logger.debug(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args)
};

const isRevenueRecognizedOrder = (order) => {
  const paymentStatus = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  return paymentStatus === 'paid' && status !== 'cancelled' && status !== 'returned';
};

const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL || 'admin@tatvadirect.com',
  password: process.env.ADMIN_PASSWORD || ''
};

const adminDeps = {
  router,
  authenticateToken,
  isAdmin: requireAdminPrivileges,
  supabase,
  console
};

const generateAdminDataBound = () =>
  generateAdminData({ supabase, console, isRevenueRecognizedOrder });

registerAdminBrandAndSupplyChainRoutes(adminDeps);

registerAdminPlatformOpsRoutes({
  ...adminDeps,
  generateAdminData: generateAdminDataBound,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
});

registerAdminUserManagementRoutes({
  ...adminDeps,
  db,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
});

registerAdminProductCatalogRoutes(adminDeps);

registerAdminProductModerationRoutes(adminDeps);
registerAdminNotificationRoutes(adminDeps);
registerProductWorkflowRoutes(adminDeps);
registerAdminAiEnhanceRoutes({
  router,
  authenticateToken,
  isAdmin: requireAdminPrivileges
});

export { router as adminRouter, ADMIN_CREDENTIALS };
