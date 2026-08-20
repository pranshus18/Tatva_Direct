import { deleteSupplierBcovLevelsForDeletedOffers } from './supplierBcovService.js';
import { pruneSupplierUpstreamCartForDeletedMineIds } from '../controllers/po/shared/poHelpers.js';

/**
 * Remove rows that block deleting a catalog product row.
 * Called before admin hard-deletes catalog products.
 */
export async function clearCatalogProductReferences(supabase, productId) {
  const { error: notificationsError } = await supabase
    .from('notifications')
    .delete()
    .eq('related_product_id', productId);

  if (notificationsError) {
    throw notificationsError;
  }

  const { error: boqItemsError } = await supabase
    .from('boq_items')
    .delete()
    .eq('normalized_product_id', productId);

  if (boqItemsError) {
    throw boqItemsError;
  }

  // Supplier onboarding links resolved requests to the created catalog product.
  const { error: productRequestsError } = await supabase
    .from('product_requests')
    .update({ resolved_product_id: null })
    .eq('resolved_product_id', productId);

  if (productRequestsError) {
    throw productRequestsError;
  }

  // Historical order lines can keep the order but must not block catalog cleanup.
  const { error: orderItemsError } = await supabase
    .from('order_items')
    .update({ product_id: null })
    .eq('product_id', productId);

  if (orderItemsError) {
    throw orderItemsError;
  }

  // Inventory movements may reference product_id without ON DELETE cascade depending on env.
  const { error: inventoryByProductError } = await supabase
    .from('inventory_movements')
    .delete()
    .eq('product_id', productId);

  if (inventoryByProductError && !isMissingRelationError(inventoryByProductError)) {
    throw inventoryByProductError;
  }

  // Offer rows block product deletes (FK) and would orphan if left behind.
  // Capture supplier/variant keys so Product_COV slabs are cleared with the offers.
  const { data: offerRows, error: offerSelectError } = await supabase
    .from('supplier_products')
    .select('id, supplier_id, variant_key')
    .eq('product_id', productId);

  if (offerSelectError && !isMissingRelationError(offerSelectError)) {
    throw offerSelectError;
  }

  const offerIds = (offerRows || []).map((row) => row.id).filter(Boolean);
  if (offerIds.length > 0) {
    const { error: inventoryByOfferError } = await supabase
      .from('inventory_movements')
      .delete()
      .in('supplier_product_id', offerIds);

    if (inventoryByOfferError && !isMissingRelationError(inventoryByOfferError)) {
      throw inventoryByOfferError;
    }

    const { error: orderItemsOfferError } = await supabase
      .from('order_items')
      .update({ supplier_product_id: null })
      .in('supplier_product_id', offerIds);

    if (orderItemsOfferError && !isMissingRelationError(orderItemsOfferError)) {
      throw orderItemsOfferError;
    }

    const { error: offersDeleteError } = await supabase
      .from('supplier_products')
      .delete()
      .eq('product_id', productId);

    if (offersDeleteError) {
      throw offersDeleteError;
    }

    try {
      await deleteSupplierBcovLevelsForDeletedOffers(supabase, offerRows || []);
    } catch (bcovCleanupError) {
      console.error(
        '[Product_COV] failed to clear levels after catalog product delete:',
        bcovCleanupError?.message || bcovCleanupError
      );
    }

    await pruneSupplierCartsForDeletedOffers(supabase, offerRows || []);
  }

  // Variant meta rows also FK to products.
  const { error: variantsError } = await supabase
    .from('product_variants')
    .delete()
    .eq('product_id', productId);

  if (variantsError && !isMissingRelationError(variantsError)) {
    throw variantsError;
  }

  // Sibling/admin-link self-references on products.
  const { error: duplicateOfError } = await supabase
    .from('products')
    .update({ duplicate_of_product_id: null })
    .eq('duplicate_of_product_id', productId);

  if (duplicateOfError && !isMissingColumnError(duplicateOfError)) {
    throw duplicateOfError;
  }
}

function isMissingRelationError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table')
  );
}

function isMissingColumnError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (message.includes('column') && message.includes('does not exist'))
  );
}

async function pruneSupplierCartsForDeletedOffers(supabase, offerRows = []) {
  const bySupplier = new Map();
  for (const row of offerRows || []) {
    const supplierId = String(row?.supplier_id || '').trim();
    const offerId = String(row?.id || '').trim();
    if (!supplierId || !offerId) continue;
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId).push(offerId);
  }
  for (const [supplierId, mineIds] of bySupplier.entries()) {
    try {
      await pruneSupplierUpstreamCartForDeletedMineIds(supabase, supplierId, mineIds);
    } catch (cartError) {
      console.warn(
        '[AdminProductDelete] failed to prune supplier cart after offer delete:',
        cartError?.message || cartError
      );
    }
  }
}

export async function deleteCatalogProduct(supabase, productId) {
  await clearCatalogProductReferences(supabase, productId);

  const { error: deleteError } = await supabase
    .from('products')
    .delete()
    .eq('id', productId);

  if (deleteError) {
    throw deleteError;
  }
}

/**
 * Delete a single supplier offer/variant without removing sibling offers.
 * If it was the last offer on the catalog product, also remove the catalog row.
 *
 * @returns {{ deletedOfferId: string, catalogDeleted: boolean }}
 */
export async function deleteCatalogOffer(supabase, { catalogProductId, supplierProductId }) {
  const offerId = String(supplierProductId || '').trim();
  const productId = String(catalogProductId || '').trim();
  if (!offerId || !productId) {
    const err = new Error('catalogProductId and supplierProductId are required');
    err.statusCode = 400;
    throw err;
  }

  const { data: offerRow, error: offerFetchError } = await supabase
    .from('supplier_products')
    .select('id, product_id, supplier_id, variant_key')
    .eq('id', offerId)
    .single();

  if (offerFetchError || !offerRow) {
    const err = new Error('Supplier variant/offer not found');
    err.statusCode = 404;
    throw err;
  }

  if (String(offerRow.product_id) !== productId) {
    const err = new Error('Variant does not belong to this catalog product');
    err.statusCode = 409;
    throw err;
  }

  const { error: inventoryByOfferError } = await supabase
    .from('inventory_movements')
    .delete()
    .eq('supplier_product_id', offerId);

  if (inventoryByOfferError && !isMissingRelationError(inventoryByOfferError)) {
    throw inventoryByOfferError;
  }

  const { error: orderItemsOfferError } = await supabase
    .from('order_items')
    .update({ supplier_product_id: null })
    .eq('supplier_product_id', offerId);

  if (orderItemsOfferError && !isMissingRelationError(orderItemsOfferError)) {
    throw orderItemsOfferError;
  }

  const { data: deletedRows, error: offerDeleteError } = await supabase
    .from('supplier_products')
    .delete()
    .eq('id', offerId)
    .eq('product_id', productId)
    .select('id');

  if (offerDeleteError) {
    throw offerDeleteError;
  }

  if (!deletedRows || deletedRows.length === 0) {
    const err = new Error('Supplier variant/offer not found');
    err.statusCode = 404;
    throw err;
  }

  try {
    await deleteSupplierBcovLevelsForDeletedOffers(supabase, [offerRow]);
  } catch (bcovCleanupError) {
    console.error(
      '[Product_COV] failed to clear levels after admin variant delete:',
      bcovCleanupError?.message || bcovCleanupError
    );
  }

  await pruneSupplierCartsForDeletedOffers(supabase, [offerRow]);

  const { count, error: countError } = await supabase
    .from('supplier_products')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);

  if (countError && !isMissingRelationError(countError)) {
    throw countError;
  }

  const remainingOffers = count || 0;
  if (remainingOffers === 0) {
    await deleteCatalogProduct(supabase, productId);
    return { deletedOfferId: offerId, catalogDeleted: true };
  }

  return { deletedOfferId: offerId, catalogDeleted: false };
}

/** @deprecated Use deleteCatalogProduct — kept for existing tests/imports. */
export const deleteRejectedCatalogProduct = deleteCatalogProduct;
