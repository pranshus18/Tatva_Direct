import {
  parseWithSchema,
  supplierProductCreateSchema
} from '../supplierImports.js';
import { buildSupplierProductCreateHandler } from './createProductHandler.js';

export function registerSupplierProductCreateRoute(ctx) {
  const { router, authenticateToken } = ctx;
  const handler = buildSupplierProductCreateHandler(ctx);

  router.post('/products', authenticateToken, async (req, res) => {
    try {
      req.body = parseWithSchema(supplierProductCreateSchema, req.body || {});
      return await handler(req, res);
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Add product route error:', error);
      return res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });
}
