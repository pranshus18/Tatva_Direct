import { supabase } from '../config/supabase.js';
import { getMaxMinimumOrderValueInrForSupplierProfile } from '../utils/supplierProfile.js';
import { insertNotification } from '../repositories/notificationsRepository.js';

function roundInr(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Parse supplier-defined LSA (Low Stock Alert) — whole units only. */
export function parseLsaThreshold(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const lsa = parseInt(String(raw).trim(), 10);
  return Number.isFinite(lsa) && lsa > 0 ? lsa : null;
}

/** True when on-hand stock is at or below the variant's configured LSA. */
export function isStockAtOrBelowLsa({ stock, lsa } = {}) {
  const lsaThreshold = parseLsaThreshold(lsa);
  if (lsaThreshold == null) return false;
  const qty = Math.max(0, parseInt(stock, 10) || 0);
  return qty <= lsaThreshold;
}

export function crossedLsaThreshold({ previousStock, newStock, lsaThreshold }) {
  const prev = Math.max(0, parseInt(previousStock, 10) || 0);
  const next = Math.max(0, parseInt(newStock, 10) || 0);
  const lsa = parseLsaThreshold(lsaThreshold);
  if (lsa == null) return false;
  return prev > lsa && next <= lsa;
}

export function crossedInventoryBelowMov({ previousStock, newStock, unitPrice, movThreshold }) {
  const prev = Math.max(0, parseInt(previousStock, 10) || 0);
  const next = Math.max(0, parseInt(newStock, 10) || 0);
  const price = Number(unitPrice);
  const mov = Number(movThreshold);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(mov) || mov <= 0) return false;
  const prevValue = roundInr(prev * price);
  const nextValue = roundInr(next * price);
  return prevValue >= mov && nextValue < mov;
}

/**
 * When stock decreases, notify the supplier if inventory value (stock × unit price)
 * crosses from at/above their profile minimum order value (MOV) to strictly below it.
 */
export async function maybeNotifyInventoryBelowMov({
  supplierId,
  supplierProductId,
  previousStock,
  newStock,
  quantityChange
}) {
  try {
    if (!supplierId || !supplierProductId) return;
    const qtyCh = Number(quantityChange);
    if (!Number.isFinite(qtyCh) || qtyCh >= 0) return;

    const prev = Math.max(0, parseInt(previousStock, 10) || 0);
    const next = Math.max(0, parseInt(newStock, 10) || 0);

    const { data: sp } = await supabase
      .from('supplier_products')
      .select('id, price, product_id, attributes')
      .eq('id', supplierProductId)
      .maybeSingle();

    if (!sp) return;

    const { data: prod } = await supabase
      .from('products')
      .select('name')
      .eq('id', sp.product_id)
      .maybeSingle();

    const attrs = sp.attributes || {};
    const name =
      (attrs.listingName != null && String(attrs.listingName).trim() !== '')
        ? String(attrs.listingName).trim()
        : prod?.name || 'Product';

    // LSA alert: notify when stock crosses from above LSA to at/below LSA.
    const lsaThreshold = parseLsaThreshold(attrs?.lsa);
    if (crossedLsaThreshold({ previousStock: prev, newStock: next, lsaThreshold })) {
      await insertNotification({
        user_id: supplierId,
        type: 'system',
        title: 'Inventory reached LSA threshold',
        message: `Your inventory of "${name}" has gone down to the defined LSA (${lsaThreshold}). Please restock.`,
        related_product_id: sp.product_id,
        is_read: false,
        metadata: {
          kind: 'inventory_below_lsa',
          supplier_product_id: supplierProductId,
          previous_stock: prev,
          new_stock: next,
          lsa_threshold: lsaThreshold
        }
      }, supabase);
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('profile')
      .eq('id', supplierId)
      .maybeSingle();

    const threshold = getMaxMinimumOrderValueInrForSupplierProfile(userRow?.profile);
    if (threshold <= 0) return;

    const price = parseFloat(sp.price);
    const unitPrice = Number.isFinite(price) && price > 0 ? price : 0;
    if (unitPrice <= 0) return;

    const prevValue = roundInr(prev * unitPrice);
    const nextValue = roundInr(next * unitPrice);
    if (!crossedInventoryBelowMov({ previousStock: prev, newStock: next, unitPrice, movThreshold: threshold })) return;

    const formattedMov = threshold.toLocaleString('en-IN');
    const formattedVal = nextValue.toLocaleString('en-IN');

    await insertNotification({
      user_id: supplierId,
      type: 'system',
      title: 'Low inventory vs minimum order value',
      message: `${name}: inventory value is ₹${formattedVal} (below your minimum order value of ₹${formattedMov}). Consider restocking.`,
      related_product_id: sp.product_id,
      is_read: false,
      metadata: {
        kind: 'inventory_below_mov',
        supplier_product_id: supplierProductId,
        previous_stock: prev,
        new_stock: next,
        unit_price: unitPrice,
        inventory_value_inr: nextValue,
        minimum_order_value_inr: threshold
      }
    }, supabase);
  } catch (e) {
    console.error('[LowInventoryMovAlert]', e);
  }
}
