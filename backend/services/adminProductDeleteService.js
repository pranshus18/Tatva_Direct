/**
 * Remove rows that block deleting a catalog product row.
 * Called before admin hard-deletes rejected catalog products.
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
  const { data: offerRows, error: offerSelectError } = await supabase
    .from('supplier_products')
    .select('id')
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

export async function deleteRejectedCatalogProduct(supabase, productId) {
  await clearCatalogProductReferences(supabase, productId);

  const { error: deleteError } = await supabase
    .from('products')
    .delete()
    .eq('id', productId);

  if (deleteError) {
    throw deleteError;
  }
}
