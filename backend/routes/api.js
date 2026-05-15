import express from 'express';
import { boqRouter } from './boq.js';
import { vendorRouter } from './vendors.js';
import { substitutionRouter } from './substitutions.js';
import { poRouter } from './po.js';
import { authRouter } from './auth.js';
import { profileRouter } from './profile.js';
import { supplierRouter } from './supplier.js';
import { dashboardRouter } from './dashboard.js';
import { adminRouter } from './admin.js';
import { receiptsRouter } from './receipts.js';
import { invoicesRouter } from './invoices.js';
import { posRouter } from './pos.js';
import { corePhase2Router } from './corePhase2.js';
import { paymentsRouter } from './payments.js';
import { adminSupplyChainRouter } from './adminSupplyChain.js';
import { vendorRequestLogger } from '../middleware/vendorRequestLogger.js';
import { distanceDebug, getEnvDebug, getHealth, getRuntimeDebug } from '../controllers/systemController.js';
import { cartShareRouter } from '../controllers/cartShareController.js';
import { logisticsRouter } from '../controllers/logisticsController.js';

const apiRouter = express.Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/supplier', supplierRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/receipts', receiptsRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/admin/supply-chain', adminSupplyChainRouter);
apiRouter.use('/boq', boqRouter);
apiRouter.use('/vendors', vendorRequestLogger, vendorRouter);
apiRouter.use('/substitutions', substitutionRouter);
apiRouter.use('/po', poRouter);
apiRouter.use('/logistics', logisticsRouter);
apiRouter.use('/pos', posRouter);
apiRouter.use('/core-phase2', corePhase2Router);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/cart-share', cartShareRouter);

apiRouter.get('/health', getHealth);
apiRouter.get('/debug/runtime', getRuntimeDebug);
if (process.env.NODE_ENV !== 'production') {
  apiRouter.get('/debug/env', getEnvDebug);
  apiRouter.get('/debug/distance-test', distanceDebug);
}

export { apiRouter };
