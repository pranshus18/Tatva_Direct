import { getContractErrorMessage, parseWithSchema, supplierProductDeleteSchema } from '../supplierImports.js';
import { deleteCatalogOffer } from '../../../services/adminProductDeleteService.js';

export function registerSupplierProductDeleteRoute(ctx) {
  const { router, authenticateToken, supabase } = ctx;

  // Delete product (supplier-specific entry, supports multiple locations)
  router.delete('/products/:id', authenticateToken, async (req, res) => {
    try {
      parseWithSchema(supplierProductDeleteSchema, req.body || {});
      const supplierProductId = req.params.id;

      const { data: supplierProduct, error: fetchError } = await supabase
        .from('supplier_products')
        .select('id, product_id, supplier_id, variant_key')
        .eq('id', supplierProductId)
        .single();

      if (fetchError || !supplierProduct) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found for this supplier'
        });
      }

      if (supplierProduct.supplier_id !== req.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to delete this product entry'
        });
      }

      try {
        await deleteCatalogOffer(supabase, {
          catalogProductId: supplierProduct.product_id,
          supplierProductId
        });
      } catch (deleteError) {
        const statusCode = Number(deleteError?.statusCode) || 400;
        return res.status(statusCode).json({
          status: 'error',
          message: deleteError.message || 'Failed to delete supplier product'
        });
      }

      return res.json({
        status: 'success',
        message: 'Product deleted successfully'
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
