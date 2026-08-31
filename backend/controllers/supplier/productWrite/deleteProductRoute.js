import { getContractErrorMessage, parseWithSchema, supplierProductDeleteSchema } from '../supplierImports.js';

export const SUPPLIER_CANNOT_DELETE_PRODUCT_MESSAGE =
  'Once a product is added, only an admin can delete it. Contact admin to remove this listing.';

export function registerSupplierProductDeleteRoute(ctx) {
  const { router, authenticateToken } = ctx;

  // Suppliers may not delete their own listings — admin owns catalog removal.
  router.delete('/products/:id', authenticateToken, async (req, res) => {
    try {
      parseWithSchema(supplierProductDeleteSchema, req.body || {});
      return res.status(403).json({
        status: 'error',
        code: 'supplier_delete_forbidden',
        message: SUPPLIER_CANNOT_DELETE_PRODUCT_MESSAGE
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Delete product error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
