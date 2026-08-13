import { getContractErrorMessage, parseWithSchema, supplierProductDeleteSchema } from '../supplierImports.js';
import { syncCatalogProductSnapshotFromOffers } from '../../../services/catalogOfferSnapshotService.js';
import { deleteSupplierBcovLevelsIfNoRemainingOffer } from '../../../services/supplierBcovService.js';

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

      const productId = supplierProduct.product_id;
      const variantKey = String(supplierProduct.variant_key || '').trim();
      const { data: deletedRows, error: spError } = await supabase
        .from('supplier_products')
        .delete()
        .eq('id', supplierProductId)
        .eq('supplier_id', req.userId)
        .select('id');

      if (spError) {
        return res.status(400).json({
          status: 'error',
          message: spError.message || 'Failed to delete supplier product'
        });
      }

      if (!deletedRows || deletedRows.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found for this supplier'
        });
      }

      // Product_COV is keyed by variant_key — remove orphaned rows so a re-list starts blank.
      if (variantKey) {
        try {
          await deleteSupplierBcovLevelsIfNoRemainingOffer(supabase, {
            supplierId: req.userId,
            variantKey
          });
        } catch (bcovCleanupError) {
          console.error(
            '[Product_COV] failed to clear levels after supplier product delete:',
            bcovCleanupError?.message || bcovCleanupError
          );
        }
      }

      const { count, error: countError } = await supabase
        .from('supplier_products')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId);

      if (!countError && (count || 0) === 0) {
        await supabase
          .from('products')
          .delete()
          .eq('id', productId);
      } else {
        void syncCatalogProductSnapshotFromOffers(supabase, productId).catch((syncError) => {
          console.error('[CatalogSnapshot] delete product sync failed:', syncError?.message || syncError);
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
