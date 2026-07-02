import { supabase } from '../config/supabase.js';
import { maybeNotifyInventoryBelowMov } from './lowInventoryMovAlertService.js';

export function computeNextStockLevel(currentStockValue, quantityChangeValue) {
  const currentStock = parseInt(currentStockValue, 10) || 0;
  const quantityChange = Number(quantityChangeValue) || 0;
  const nextStock = currentStock + quantityChange;
  if (quantityChange < 0 && nextStock < 0) {
    throw new Error(
      `Insufficient stock for inventory movement. Available=${currentStock}, requested=${Math.abs(quantityChange)}`
    );
  }
  return Math.max(0, nextStock);
}

/**
 * Record an inventory movement and update supplier_products.stock.
 *
 * This is a minimal, v1 implementation:
 * - Reads current stock from supplier_products
 * - Applies quantityChange (positive or negative)
 * - Prevents stock from going below zero
 * - Writes an inventory_movements row for traceability
 *
 * For higher concurrency, consider moving stock math into a Postgres function.
 */
export async function recordInventoryMovement({
  supplierProductId,
  supplierId,
  productId,
  quantityChange,
  movementType,
  referenceOrderId = null,
  referenceOrderItemId = null,
  notes = '',
  userId = null
}) {
  if (!supplierProductId || !quantityChange || !movementType) {
    console.error('[Inventory] Missing required fields for recordInventoryMovement', {
      supplierProductId,
      supplierId,
      productId,
      quantityChange,
      movementType
    });
    throw new Error('Missing required fields for inventory movement');
  }

  // 1) Load the offer row — stock always belongs to this supplier_product's owner (seller in the chain).
  const { data: row, error: spError } = await supabase
    .from('supplier_products')
    .select('id, supplier_id, product_id, stock')
    .eq('id', supplierProductId)
    .single();

  if (spError || !row) {
    console.error('[Inventory] Failed to load supplier_product for movement', spError);
    throw new Error('Supplier product not found for inventory movement');
  }

  const ownerSupplierId = row.supplier_id;
  const effectiveProductId = productId || row.product_id;

  if (!effectiveProductId) {
    throw new Error('productId is required when supplier_products row has no product_id');
  }

  if (supplierId && supplierId !== ownerSupplierId) {
    console.error('[Inventory] supplierId does not own this supplier_product', {
      supplierId,
      ownerSupplierId,
      supplierProductId
    });
    throw new Error(
      'Inventory movement rejected: supplier does not own this product offer. Stock is only adjusted for the seller whose offer was purchased.'
    );
  }

  const maxAttempts = 5;
  let currentStock = 0;
  let newStock = 0;

  // 2) Update stock with optimistic locking to avoid lost updates during concurrent checkout holds.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: latestRow, error: latestError } = await supabase
      .from('supplier_products')
      .select('stock')
      .eq('id', supplierProductId)
      .eq('supplier_id', ownerSupplierId)
      .maybeSingle();

    if (latestError || !latestRow) {
      console.error('[Inventory] Failed to reload supplier_product for movement retry', latestError);
      throw new Error('Supplier product not found for inventory movement');
    }

    currentStock = parseInt(latestRow.stock, 10) || 0;
    newStock = computeNextStockLevel(currentStock, quantityChange);

    const { data: updatedRow, error: updateError } = await supabase
      .from('supplier_products')
      .update({ stock: newStock })
      .eq('id', supplierProductId)
      .eq('supplier_id', ownerSupplierId)
      .eq('stock', currentStock)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[Inventory] Failed to update stock on supplier_products', updateError);
      throw new Error('Failed to update stock for inventory movement');
    }

    if (updatedRow) break;
    if (attempt === maxAttempts - 1) {
      throw new Error('Failed to update stock due to concurrent inventory changes. Please retry.');
    }
  }

  // 3) Insert inventory_movements row for ledger
  const { error: movementError } = await supabase
    .from('inventory_movements')
    .insert({
      supplier_product_id: supplierProductId,
      supplier_id: ownerSupplierId,
      product_id: effectiveProductId,
      quantity_change: quantityChange,
      movement_type: movementType,
      reference_order_id: referenceOrderId,
      reference_order_item_id: referenceOrderItemId,
      notes,
      created_by: userId || ownerSupplierId
    });

  if (movementError) {
    console.error('[Inventory] Failed to insert inventory_movement', movementError);
    throw new Error('Failed to record inventory movement');
  }

  void maybeNotifyInventoryBelowMov({
    supplierId: ownerSupplierId,
    supplierProductId,
    previousStock: currentStock,
    newStock,
    quantityChange
  });

  return { previousStock: currentStock, newStock };
}

