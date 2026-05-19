import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { createAdminWriteNotifyMiddleware } from '../middleware/adminWriteNotifyMiddleware.js';
import { notifyAdminsForPortalAction } from '../services/portalActivityService.js';
import { registerDashboardOrderDeletionRoutes } from './dashboard/orderDeletionRoutes.js';
import { createDashboardRouteContext } from './dashboard/createRouteContext.js';
import { registerDashboardServiceProviderDashboardRoutes } from './dashboard/serviceProviderDashboardRoutes.js';
import { registerDashboardSupplierDashboardRoutes } from './dashboard/supplierDashboardRoutes.js';
import { registerDashboardOrderDetailRoutes } from './dashboard/orderDetailRoutes.js';
import { registerDashboardReturnRoutes } from './dashboard/returnRoutes.js';
import { registerDashboardPaymentRoutes } from './dashboard/paymentRoutes.js';
import { restockInventoryForCancelledOrder } from './dashboard/shared/dashboardHelpers.js';

const router = express.Router();

router.use(createAdminWriteNotifyMiddleware({ supabase, notifyAdminsForPortalAction }));

const ctx = createDashboardRouteContext(router, authenticateToken);

registerDashboardServiceProviderDashboardRoutes(ctx);
registerDashboardSupplierDashboardRoutes(ctx);
registerDashboardOrderDetailRoutes(ctx);
registerDashboardReturnRoutes(ctx);
registerDashboardPaymentRoutes(ctx);

registerDashboardOrderDeletionRoutes({
  router,
  authenticateToken,
  supabase,
  restockInventoryForCancelledOrder,
  userRolePath: 'service-provider',
  userColumn: 'service_provider_id',
  actorLabel: 'service provider'
});

registerDashboardOrderDeletionRoutes({
  router,
  authenticateToken,
  supabase,
  restockInventoryForCancelledOrder,
  userRolePath: 'supplier',
  userColumn: 'supplier_id',
  actorLabel: 'supplier'
});

export { router as dashboardRouter };
