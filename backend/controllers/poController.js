import express from 'express';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { createPoRouteContext } from './po/createRouteContext.js';
import { registerPoGroupRoutes } from './po/groupRoutes.js';
import { registerPoCreateRoutes } from './po/createRoutes.js';
import { registerPoTransportRoutes } from './po/transportRoutes.js';
import { registerPoCartRoutes } from './po/cartRoutes.js';
import { registerPoOrderActionRoutes } from './po/orderActionRoutes.js';
import { registerPoCreditRoutes } from './po/creditRoutes.js';

const router = express.Router();
const ctx = createPoRouteContext(router, authenticateToken, isServiceProvider);

registerPoGroupRoutes(ctx);
registerPoCreateRoutes(ctx);
registerPoTransportRoutes(ctx);
registerPoCartRoutes(ctx);
registerPoOrderActionRoutes(ctx);
registerPoCreditRoutes(ctx);

export { router as poRouter };
