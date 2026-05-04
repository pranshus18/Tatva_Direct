import { supabase } from '../config/supabase.js';
import { recordInventoryMovement } from './inventoryService.js';

/**
 * When a return is fully closed (goods back, case resolved), add salable stock back
 * on the supplier_product that fulfilled the line item — mirroring sale_online deduction.
 *
 * Idempotent: one successful restock per return id (tracked via inventory_movements.notes).
 * Honors partial restocks already applied via policy (order_returns.restocked_quantity).
 * Skips when disposition is scrap (not resellable).
 */
export async function applyRestockForClosedReturn(returnRow, actorUserId) {
  const returnId = returnRow?.id;
  if (!returnId) {
    return { ok: false, reason: 'invalid_return' };
  }

  if (String(returnRow.disposition || '') === 'scrap') {
    return { ok: true, skipped: true, reason: 'scrap' };
  }

  const { data: dup } = await supabase
    .from('inventory_movements')
    .select('id')
    .ilike('notes', `%return_closed_restock:${returnId}%`)
    .limit(1);

  if (dup && dup.length > 0) {
    return { ok: true, already: true };
  }

  const qtyTotal = Number(returnRow.quantity) || 0;
  const alreadyRestocked = Number(returnRow.restocked_quantity) || 0;
  const qtyToAdd = Math.max(0, Math.round(qtyTotal - alreadyRestocked));

  if (qtyToAdd <= 0) {
    return { ok: true, skipped: true, reason: 'nothing_to_restock' };
  }

  const { data: orderItem, error: oiErr } = await supabase
    .from('order_items')
    .select('id, product_id, supplier_product_id, quantity')
    .eq('id', returnRow.order_item_id)
    .maybeSingle();

  if (oiErr || !orderItem?.supplier_product_id) {
    console.error('[Return restock] order_item missing or no supplier_product_id', {
      orderItemId: returnRow.order_item_id,
      oiErr
    });
    return { ok: false, reason: 'missing_supplier_product' };
  }

  await recordInventoryMovement({
    supplierProductId: orderItem.supplier_product_id,
    supplierId: returnRow.supplier_id,
    productId: orderItem.product_id,
    quantityChange: qtyToAdd,
    movementType: 'return_sale',
    referenceOrderId: returnRow.order_id,
    referenceOrderItemId: orderItem.id,
    notes: `Return closed — inventory restocked return_closed_restock:${returnId}`,
    userId: actorUserId || returnRow.supplier_id
  });

  const nextRestocked = alreadyRestocked + qtyToAdd;
  const { error: updErr } = await supabase
    .from('order_returns')
    .update({
      restocked_quantity: nextRestocked,
      disposition: returnRow.disposition || 'restock',
      processed_at: new Date().toISOString()
    })
    .eq('id', returnId);

  if (updErr) {
    console.error('[Return restock] failed to update order_returns totals', updErr);
  }

  return { ok: true, qtyToAdd, restocked_quantity: nextRestocked };
}
