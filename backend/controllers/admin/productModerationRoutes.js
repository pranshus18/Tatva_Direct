import { insertNotification, insertNotifications } from '../../repositories/notificationsRepository.js';
import {
  adminProductApproveSchema,
  adminProductDeleteSchema,
  adminApproveAllProductsSchema,
  adminProductRejectSchema
} from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { syncCatalogProductSnapshotFromOffers } from '../../services/catalogOfferSnapshotService.js';
import { isSupplierUserType } from '../../utils/notificationAudience.js';
import { validateAdminProductApprovalReadiness, mergeOfferIntoProductForApproval } from '../../services/adminProductApprovalReadinessService.js';

function supplierOfferRecipients(supplierProductRows, fallbackSupplier) {
  const isCatalogSupplierRecipient = (supplier) => {
    if (!supplier?.id) return false;
    // Legacy joins may omit user_type; only exclude when type is present and not supplier.
    if (supplier.user_type == null || String(supplier.user_type).trim() === '') return true;
    return isSupplierUserType(supplier.user_type);
  };

  const fromOffers = (Array.isArray(supplierProductRows) ? supplierProductRows : [])
    .map((row) => row?.supplier)
    .filter(isCatalogSupplierRecipient);

  if (fromOffers.length > 0) return fromOffers;
  if (isCatalogSupplierRecipient(fallbackSupplier)) return [fallbackSupplier];
  return [];
}

export function registerAdminProductModerationRoutes({ router, authenticateToken, isAdmin, supabase }) {
  // Approve product (admin only)
  router.post('/products/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
      parseWithSchema(adminProductApproveSchema, req.body || {});

      const { data: existingProduct, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();

      if (fetchError || !existingProduct) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found'
        });
      }

      const { data: offerRow } = await supabase
        .from('supplier_products')
        .select('igst_rate, cgst_rate, sgst_rate, attributes, updated_at')
        .eq('product_id', req.params.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const productForApproval = mergeOfferIntoProductForApproval(existingProduct, offerRow);
      const readiness = validateAdminProductApprovalReadiness(productForApproval);
      if (!readiness.ok) {
        return res.status(400).json({
          status: 'error',
          code: 'approval_not_ready',
          message: readiness.message,
          missingRequirements: readiness.missingRequirements
        });
      }

      // Update product status
      const { data: product, error: updateError } = await supabase
        .from('products')
        .update({
          status: 'approved',
          approved_by: req.userId,
          approved_at: new Date().toISOString(),
          is_active: true,
          rejection_reason: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', req.params.id)
        .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, email, user_type)
      `)
        .single();

      if (updateError || !product) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found'
        });
      }

      const nowIso = new Date().toISOString();

      // IMPORTANT: Approval on the shared `products` row must also approve all supplier offers
      // in `supplier_products`, otherwise supplier portal will still show them as "pending".
      const { data: existingSupplierProducts } = await supabase
        .from('supplier_products')
        .select('id')
        .eq('product_id', product.id);

      let approvedSupplierProducts = [];
      console.log(`[ADMIN APPROVE PRODUCT] supplier_products existing rows for product ${product.id}: ${existingSupplierProducts?.length || 0}`);

      // If no supplier_products exist for this product yet, try to backfill from legacy `products`.
      // This prevents the supplier portal/inventory from being stuck when older products were created
      // without the junction table rows.
      if ((!existingSupplierProducts || existingSupplierProducts.length === 0) && product.supplier_id) {
        try {
          const legacySupplierId = product.supplier_id;
          const legacyPrice = parseFloat(product.price) || 0;
          const legacyStock = parseInt(product.stock) || 0;
          const legacyMinOrderQty = parseInt(product.min_order_quantity) || 1;
          const legacyLocation = (product.location || 'Not specified').toString();

          const { data: inserted, error: insertError } = await supabase
            .from('supplier_products')
            .insert({
              product_id: product.id,
              supplier_id: legacySupplierId,
              price: legacyPrice,
              stock: legacyStock,
              min_order_quantity: legacyMinOrderQty,
              location: legacyLocation,
              status: 'approved',
              is_active: true,
              approved_by: req.userId,
              approved_at: nowIso,
              rejection_reason: null,
              attributes: {},
              created_at: nowIso,
              updated_at: nowIso
            })
            .select(`
            supplier_id,
            supplier:users!supplier_products_supplier_id_fkey (id, name, email, company, user_type)
          `);

          if (insertError) {
            console.error('[ADMIN APPROVE PRODUCT] Failed to backfill supplier_products:', insertError);
          } else if (inserted) {
            approvedSupplierProducts = Array.isArray(inserted) ? inserted : [inserted];
            console.log('[ADMIN APPROVE PRODUCT] Backfilled supplier_products from legacy products');
          }
        } catch (e) {
          console.error('[ADMIN APPROVE PRODUCT] Backfill exception:', e);
        }
      }

      // Update all supplier_products rows (either existing ones, or ones we just backfilled).
      const { data: updatedSupplierProducts, error: spUpdateError } = await supabase
        .from('supplier_products')
        .update({
          status: 'approved',
          is_active: true,
          approved_by: req.userId,
          approved_at: nowIso,
          rejection_reason: null,
          updated_at: nowIso
        })
        .eq('product_id', product.id)
        .select(`
        supplier_id,
        supplier:users!supplier_products_supplier_id_fkey (id, name, email, company, user_type)
      `);

      if (spUpdateError) {
        console.error('[ADMIN APPROVE PRODUCT] Failed to update supplier_products:', spUpdateError);
      } else if (updatedSupplierProducts) {
        approvedSupplierProducts = updatedSupplierProducts;
      }
      console.log(`[ADMIN APPROVE PRODUCT] supplier_products updated rows: ${updatedSupplierProducts?.length || 0}`);

      void syncCatalogProductSnapshotFromOffers(supabase, product.id).catch((syncError) => {
        console.error('[CatalogSnapshot] admin approve sync failed:', syncError?.message || syncError);
      });

      // Create notification(s) for supplier(s) whose offer got approved (never SPs/admins).
      const suppliersToNotify = supplierOfferRecipients(
        approvedSupplierProducts,
        product.supplier
      );

      if (suppliersToNotify.length > 0) {
        const notifications = suppliersToNotify.map((supplier) => ({
          user_id: supplier.id,
          type: 'product_approval',
          title: `Product Approved: ${product.name}`,
          message: `Your product "${product.name}" has been approved by admin and is now active in the marketplace.`,
          related_product_id: product.id,
          metadata: {
            productName: product.name,
            status: 'approved'
          }
        }));

        await insertNotifications(notifications, supabase);
        console.log(`Created ${notifications.length} supplier notification(s) about product approval`);
      }

      // If this product originated from a service provider request, notify
      // all suppliers so they can add this product, and notify the requesting
      // service provider that their requested product is now approved.
      if (product.requested_by_service_provider_id) {
        // Notify all suppliers about the newly approved requested product
        try {
          const { data: suppliers } = await supabase
            .from('users')
            .select('id, name, company')
            .eq('user_type', 'supplier');

          if (suppliers && suppliers.length > 0) {
            const supplierNotifications = suppliers.map((supplier) => ({
              user_id: supplier.id,
              type: 'system',
              title: `New Product Available: ${product.name}`,
              message: `A service provider has requested the product "${product.name}" in category "${product.category}". This product is now approved. If you stock this item, please add your price, stock and location from the supplier portal so it can be included in upcoming BOQs/POs.`,
              related_product_id: product.id,
              metadata: {
                productId: product.id,
                productName: product.name,
                productCategory: product.category,
                productUnit: product.unit,
                source: 'service_provider_request'
              }
            }));

            await insertNotifications(supplierNotifications, supabase);
            console.log(
              `[ADMIN APPROVE PRODUCT] Created ${supplierNotifications.length} supplier notification(s) for requested product ${product.id}`
            );
          }
        } catch (supplierNotifError) {
          console.error(
            '[ADMIN APPROVE PRODUCT] Failed to create supplier notifications for requested product:',
            supplierNotifError
          );
        }

        // Notify the requesting service provider that their requested product is approved
        try {
          await insertNotification({
              user_id: product.requested_by_service_provider_id,
              type: 'system',
              title: `Your requested product was approved: ${product.name}`,
              message:
              `Your requested product "${product.name}" has been approved by admin. All suppliers have been notified so they can add their offers. You will receive notifications as suppliers add this product.`,
              related_product_id: product.id,
              metadata: {
                productId: product.id,
                productName: product.name,
                productCategory: product.category,
                productUnit: product.unit,
                source: 'service_provider_request_approved'
              }
            }, supabase);
          console.log(
            `[ADMIN APPROVE PRODUCT] Notified service provider ${product.requested_by_service_provider_id} about requested product approval`
          );
        } catch (spNotifError) {
          console.error(
            '[ADMIN APPROVE PRODUCT] Failed to notify requesting service provider about approval:',
            spNotifError
          );
        }
      }

      res.json({
        status: 'success',
        message: 'Product approved successfully',
        product
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Approve product error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Reject product (admin only)
  router.post('/products/:id/reject', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { reason } = parseWithSchema(adminProductRejectSchema, req.body || {});

      const { data: product, error: updateError } = await supabase
        .from('products')
        .update({
          status: 'rejected',
          rejection_reason: reason || 'Product rejected by admin',
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', req.params.id)
        .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, email, user_type)
      `)
        .single();

      if (updateError || !product) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found'
        });
      }

      const nowIso = new Date().toISOString();

      // IMPORTANT: Keep `supplier_products` in sync with the shared product approval state.
      const { data: existingSupplierProducts } = await supabase
        .from('supplier_products')
        .select('id')
        .eq('product_id', product.id);

      let rejectedSupplierProducts = [];
      console.log(`[ADMIN REJECT PRODUCT] supplier_products existing rows for product ${product.id}: ${existingSupplierProducts?.length || 0}`);

      // Backfill legacy products if junction rows don't exist yet.
      if ((!existingSupplierProducts || existingSupplierProducts.length === 0) && product.supplier_id) {
        try {
          const legacySupplierId = product.supplier_id;
          const legacyPrice = parseFloat(product.price) || 0;
          const legacyStock = parseInt(product.stock) || 0;
          const legacyMinOrderQty = parseInt(product.min_order_quantity) || 1;
          const legacyLocation = (product.location || 'Not specified').toString();
          const rejectionReason = reason || product.rejection_reason || 'Product rejected by admin';

          const { data: inserted, error: insertError } = await supabase
            .from('supplier_products')
            .insert({
              product_id: product.id,
              supplier_id: legacySupplierId,
              price: legacyPrice,
              stock: legacyStock,
              min_order_quantity: legacyMinOrderQty,
              location: legacyLocation,
              status: 'rejected',
              is_active: false,
              approved_by: null,
              approved_at: null,
              rejection_reason: rejectionReason,
              attributes: {},
              created_at: nowIso,
              updated_at: nowIso
            })
            .select(`
            supplier_id,
            supplier:users!supplier_products_supplier_id_fkey (id, name, email, company, user_type)
          `);

          if (insertError) {
            console.error('[ADMIN REJECT PRODUCT] Failed to backfill supplier_products:', insertError);
          } else if (inserted) {
            rejectedSupplierProducts = Array.isArray(inserted) ? inserted : [inserted];
            console.log('[ADMIN REJECT PRODUCT] Backfilled supplier_products from legacy products');
          }
        } catch (e) {
          console.error('[ADMIN REJECT PRODUCT] Backfill exception:', e);
        }
      }

      // Update all supplier_products rows.
      const { data: updatedSupplierProducts, error: spRejectUpdateError } = await supabase
        .from('supplier_products')
        .update({
          status: 'rejected',
          is_active: false,
          rejection_reason: reason || product.rejection_reason || 'Product rejected by admin',
          approved_by: null,
          approved_at: null,
          updated_at: nowIso
        })
        .eq('product_id', product.id)
        .select(`
        supplier_id,
        supplier:users!supplier_products_supplier_id_fkey (id, name, email, company, user_type)
      `);

      if (spRejectUpdateError) {
        console.error('[ADMIN REJECT PRODUCT] Failed to update supplier_products:', spRejectUpdateError);
      } else if (updatedSupplierProducts) {
        rejectedSupplierProducts = updatedSupplierProducts;
      }
      console.log(`[ADMIN REJECT PRODUCT] supplier_products updated rows: ${updatedSupplierProducts?.length || 0}`);

      const rejectionReasonText =
        reason || product.rejection_reason || 'No reason provided';
      const suppliersToNotify = supplierOfferRecipients(
        rejectedSupplierProducts,
        product.supplier
      );

      // Create notification(s) for supplier(s) whose offer got rejected (never SPs/admins).
      if (suppliersToNotify.length > 0) {
        const notifications = suppliersToNotify.map((supplier) => ({
          user_id: supplier.id,
          type: 'product_approval',
          title: `Product Rejected: ${product.name}`,
          message: `Your product "${product.name}" has been rejected by admin. Reason: ${rejectionReasonText}`,
          related_product_id: product.id,
          metadata: {
            productName: product.name,
            status: 'rejected',
            rejectionReason: reason || product.rejection_reason || null
          }
        }));

        await insertNotifications(notifications, supabase);
        console.log(`Created ${notifications.length} supplier notification(s) about product rejection`);
      }

      // If this product originated from a service provider request, notify the requester
      // with a procurement-facing status update (not supplier catalog "Product Rejected").
      if (product.requested_by_service_provider_id) {
        try {
          await insertNotification(
            {
              user_id: product.requested_by_service_provider_id,
              type: 'system',
              title: `Your requested product was rejected: ${product.name}`,
              message: `Your requested product "${product.name}" was rejected by admin. Reason: ${rejectionReasonText}`,
              related_product_id: product.id,
              metadata: {
                productId: product.id,
                productName: product.name,
                status: 'rejected',
                rejectionReason: reason || product.rejection_reason || null,
                source: 'service_provider_request_rejected'
              }
            },
            supabase
          );
          console.log(
            `[ADMIN REJECT PRODUCT] Notified service provider ${product.requested_by_service_provider_id} about requested product rejection`
          );
        } catch (spNotifError) {
          console.error(
            '[ADMIN REJECT PRODUCT] Failed to notify requesting service provider about rejection:',
            spNotifError
          );
        }
      }

      res.json({
        status: 'success',
        message: 'Product rejected successfully',
        product
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Reject product error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Delete a rejected product (admin only)
  // Safety: only allows deletion if product.status === 'rejected'
  router.delete('/products/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      parseWithSchema(adminProductDeleteSchema, req.body || {});
      const productId = req.params?.id;
      // Hard safety: never allow deletion with missing/undefined ids.
      if (!productId || productId === 'undefined' || productId === 'null') {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid product id'
        });
      }

      const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();

      if (fetchError || !product) {
        return res.status(404).json({
          status: 'error',
          message: 'Product not found'
        });
      }

      // Additional safety: ensure the fetched row matches the requested id.
      if (String(product.id) !== String(productId)) {
        return res.status(409).json({
          status: 'error',
          message: 'Product id mismatch'
        });
      }

      if ((product.status || 'pending') !== 'rejected') {
        return res.status(400).json({
          status: 'error',
          message: 'Only rejected products can be deleted'
        });
      }

      // Remove notifications referencing this product to avoid broken references
      await supabase
        .from('notifications')
        .delete()
        .eq('related_product_id', product.id);

      // Important: `products` cannot be deleted if BOQ items still reference it.
      // Your DB constraint is: `boq_items.normalized_product_id` -> `products.id`.
      // So delete dependent BOQ items first to unblock product deletion.
      const { error: boqItemsDeleteError } = await supabase
        .from('boq_items')
        .delete()
        .eq('normalized_product_id', productId);

      if (boqItemsDeleteError) {
        console.error('Delete BOQ items error (normalized_product_id):', boqItemsDeleteError);
        throw boqItemsDeleteError;
      }

      // Delete the product
      const { error: deleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);

      if (deleteError) {
        throw deleteError;
      }

      return res.json({
        status: 'success',
        message: 'Rejected product deleted successfully'
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

  // Get pending products for approval (admin only)
  router.get('/products/pending', authenticateToken, isAdmin, async (req, res) => {
    try {
      // Find all products that are NOT approved or rejected
      // This includes products with: 'pending', null, undefined, empty string, or missing status field
      const { data: allProducts } = await supabase
        .from('products')
        .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, email, company)
      `)
        .order('created_at', { ascending: false });

      // Filter pending products in JavaScript (products that are not approved or rejected)
      const { data: pendingOffers } = await supabase
        .from('supplier_products')
        .select('product_id')
        .eq('status', 'pending');

      const pendingOfferProductIds = new Set(
        (pendingOffers || []).map((row) => row.product_id).filter(Boolean)
      );

      const pendingProducts = (allProducts || []).filter((p) => {
        const status = p.status;
        const isPendingStatus =
          !status || status === 'pending' || status === '' || (status !== 'approved' && status !== 'rejected');
        return isPendingStatus && pendingOfferProductIds.has(p.id);
      });

      console.log(`📦 Found ${pendingProducts.length} pending products`);

      // Log first few products for debugging
      if (pendingProducts.length > 0) {
        console.log('Sample pending products:', pendingProducts.slice(0, 3).map(p => ({
          name: p.name,
          status: p.status,
          supplier: p.supplier?.name || 'Unknown',
          hasSpecifications: !!p.specifications,
          specifications: p.specifications,
          specificationsKeys: p.specifications ? Object.keys(p.specifications) : []
        })));
      }

      res.json({
        status: 'success',
        products: pendingProducts,
        count: pendingProducts.length
      });
    } catch (error) {
      console.error('Get pending products error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        error: error.message
      });
    }
  });

  // Diagnostic endpoint to check product statuses (admin only)
  router.get('/products/status-check', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { data: allProducts } = await supabase
        .from('products')
        .select('name, status, is_active');

      const statusCounts = {
        approved: 0,
        pending: 0,
        rejected: 0,
        null: 0,
        undefined: 0,
        empty: 0,
        other: 0
      };

      (allProducts || []).forEach(product => {
        const status = product.status;
        if (status === 'approved') statusCounts.approved++;
        else if (status === 'pending') statusCounts.pending++;
        else if (status === 'rejected') statusCounts.rejected++;
        else if (status === null) statusCounts.null++;
        else if (status === undefined) statusCounts.undefined++;
        else if (status === '') statusCounts.empty++;
        else statusCounts.other++;
      });

      res.json({
        status: 'success',
        totalProducts: (allProducts || []).length,
        statusCounts,
        products: (allProducts || []).map(p => ({ name: p.name, status: p.status, isActive: p.is_active }))
      });
    } catch (error) {
      console.error('Status check error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Approve all existing pending products (admin only) - for migrating old products
  router.post('/products/approve-all', authenticateToken, isAdmin, async (req, res) => {
    try {
      parseWithSchema(adminApproveAllProductsSchema, req.body || {});
      const { data: allProducts } = await supabase.from('products').select('*');

      const pendingProducts = (allProducts || []).filter((p) => {
        const status = p.status;
        return !status || status === '' || (status !== 'approved' && status !== 'rejected');
      });

      const pendingIds = pendingProducts.map((p) => p.id).filter(Boolean);
      const { data: offerRows } = pendingIds.length
        ? await supabase
            .from('supplier_products')
            .select('product_id, igst_rate, cgst_rate, sgst_rate, attributes, updated_at')
            .in('product_id', pendingIds)
        : { data: [] };

      const bestOfferByProduct = new Map();
      for (const row of offerRows || []) {
        const productId = row.product_id;
        if (!productId) continue;
        const existing = bestOfferByProduct.get(productId);
        if (!existing || String(row.updated_at || '') > String(existing.updated_at || '')) {
          bestOfferByProduct.set(productId, row);
        }
      }

      const readinessFor = (product) =>
        validateAdminProductApprovalReadiness(
          mergeOfferIntoProductForApproval(product, bestOfferByProduct.get(product.id))
        );

      const readyProducts = pendingProducts.filter((p) => readinessFor(p).ok);
      const skippedProducts = pendingProducts.filter((p) => !readinessFor(p).ok);

      console.log(`Found ${pendingProducts.length} pending products; ${readyProducts.length} ready to approve`);

      if (readyProducts.length === 0) {
        return res.json({
          status: 'success',
          message:
            pendingProducts.length === 0
              ? 'No pending products found'
              : 'No pending products are ready for approval. Set description, GST, and specifications first.',
          approvedCount: 0,
          skippedCount: skippedProducts.length
        });
      }

      const productIds = readyProducts.map((p) => p.id);
      const nowIso = new Date().toISOString();
      const { data: updatedProducts, error: updateError } = await supabase
        .from('products')
        .update({
          status: 'approved',
          is_active: true,
          approved_by: req.userId,
          approved_at: nowIso,
          rejection_reason: null,
          updated_at: nowIso
        })
        .in('id', productIds)
        .select('name, status, is_active')
        .limit(10);

      if (updateError) {
        throw updateError;
      }

      // Keep supplier portal in sync: approve matching supplier offers too.
      const { data: updatedOffers, error: offerUpdateError } = await supabase
        .from('supplier_products')
        .update({
          status: 'approved',
          is_active: true,
          approved_by: req.userId,
          approved_at: nowIso,
          rejection_reason: null,
          updated_at: nowIso
        })
        .in('product_id', productIds)
        .select('id, product_id, supplier_id');

      if (offerUpdateError) {
        console.error('[ADMIN APPROVE ALL] Failed to sync supplier_products:', offerUpdateError);
      } else {
        console.log(
          `[ADMIN APPROVE ALL] Synced ${updatedOffers?.length || 0} supplier_products offer(s)`
        );
      }

      console.log(`Admin ${req.userId} approved ${readyProducts.length} ready product(s)`);

      res.json({
        status: 'success',
        message:
          skippedProducts.length > 0
            ? `Approved ${readyProducts.length} product(s). Skipped ${skippedProducts.length} that still need description, GST, or specifications.`
            : `Successfully approved ${readyProducts.length} product(s)`,
        approvedCount: readyProducts.length,
        skippedCount: skippedProducts.length,
        supplierOffersSynced: updatedOffers?.length || 0,
        products: updatedProducts || []
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Approve all products error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        error: error.message
      });
    }
  });
}
