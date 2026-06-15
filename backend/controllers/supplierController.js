import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { createAdminWriteNotifyMiddleware } from '../middleware/adminWriteNotifyMiddleware.js';
import { notifyAdminsForPortalAction } from '../services/portalActivityService.js';
import { createSupplierRouteContext } from './supplier/createRouteContext.js';
import { registerSupplierNotificationRoutes } from './supplier/notificationRoutes.js';
import { registerSupplierSetupRoutes } from './supplier/setupRoutes.js';
import { registerSupplierProductListRoutes } from './supplier/productListRoutes.js';
import { registerSupplierOutletRoutes } from './supplier/outletRoutes.js';
import { registerSupplierCatalogRoutes } from './supplier/catalogRoutes.js';
import { registerSupplierProductWriteRoutes } from './supplier/productWriteRoutes.js';
import { registerSupplierOrderRoutes } from './supplier/orderRoutes.js';
import { registerSupplierInventoryRoutes } from './supplier/inventoryRoutes.js';
import { registerSupplierUpstreamRoutes } from './supplier/upstreamRoutes.js';
import { registerSupplierAnalyticsRoutes } from './supplier/analyticsRoutes.js';
import { registerSupplierProductAiRoutes } from './supplier/productAiRoutes.js';
import { registerSupplierCreditRoutes } from './supplier/creditRoutes.js';
import { registerSupplierWalletRoutes } from './supplier/walletRoutes.js';

const router = express.Router();

router.use(createAdminWriteNotifyMiddleware({ supabase, notifyAdminsForPortalAction }));

const ctx = createSupplierRouteContext(router, authenticateToken);

registerSupplierSetupRoutes(ctx);
registerSupplierProductListRoutes(ctx);
registerSupplierOutletRoutes(ctx);
registerSupplierCatalogRoutes(ctx);
registerSupplierProductWriteRoutes(ctx);
registerSupplierOrderRoutes(ctx);
registerSupplierInventoryRoutes(ctx);
registerSupplierUpstreamRoutes(ctx);
registerSupplierAnalyticsRoutes(ctx);
registerSupplierProductAiRoutes(ctx);
registerSupplierCreditRoutes(ctx);
registerSupplierWalletRoutes(ctx);
registerSupplierNotificationRoutes({ router, authenticateToken, supabase });

export { router as supplierRouter };
