import { supabase } from '../config/supabase.js';
import { getMaxMinimumOrderValueInrForSupplierProfile } from '../utils/supplierProfile.js';
import { insertNotification } from '../repositories/notificationsRepository.js';
import { parseSupplierOfferAttributes } from './supplierCatalogHelpersService.js';

function roundInr(n) {
  return Math.round(Number(n) * 100) / 100;
}

function asObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return parseSupplierOfferAttributes(raw);
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

/**
 * Read LSA from the supplier offer (JSONB or legacy JSON string) and related spec maps.
 */
export function resolveLsaThreshold(attributes = {}, product = {}) {
  const attrs = parseSupplierOfferAttributes(attributes);
  const specs = asObject(attrs.specifications);
  const productAttrs = parseSupplierOfferAttributes(product?.attributes);
  const productSpecs = asObject(product?.specifications);
  return parseLsaThreshold(
    attrs.lsa ??
      attrs.LSA ??
      specs.lsa ??
      specs.LSA ??
      productAttrs.lsa ??
      productSpecs.lsa ??
      product?.lsa
  );
}

/**
 * Notify when stock crosses into LSA, decreases while already at/below LSA,
 * or when LSA is newly set/raised so current stock now hits it.
 */
export function shouldNotifyLsaHit({
  previousStock,
  newStock,
  lsaThreshold,
  previousLsaThreshold
} = {}) {
  const next = Math.max(0, parseInt(newStock, 10) || 0);
  const lsa = parseLsaThreshold(lsaThreshold);
  if (lsa == null) return false;
  if (!isStockAtOrBelowLsa({ stock: next, lsa })) return false;

  if (crossedLsaThreshold({ previousStock, newStock: next, lsaThreshold: lsa })) {
    return true;
  }

  if (previousLsaThreshold !== undefined) {
    const oldLsa = parseLsaThreshold(previousLsaThreshold);
    if (oldLsa == null) return true;
    return !isStockAtOrBelowLsa({ stock: next, lsa: oldLsa });
  }

  const prev = Math.max(0, parseInt(previousStock, 10) || 0);
  return next < prev;
}

export function buildLsaNotificationPayload({
  supplierId,
  productId,
  supplierProductId,
  productName,
  previousStock,
  newStock,
  lsaThreshold
} = {}) {
  const name = String(productName || 'Product').trim() || 'Product';
  const qty = Math.max(0, parseInt(newStock, 10) || 0);
  const lsa = parseLsaThreshold(lsaThreshold);
  const payload = {
    user_id: supplierId,
    type: 'system',
    title: 'Low stock alert: inventory reached LSA',
    message: `Your inventory of "${name}" is at ${qty} unit${qty === 1 ? '' : 's'}, which is at or below your Low Stock Alert (${lsa}). Please restock.`,
    is_read: false,
    metadata: {
      source: 'low_inventory',
      event: 'inventory_below_lsa',
      kind: 'inventory_below_lsa',
      supplier_product_id: supplierProductId,
      previous_stock: previousStock,
      new_stock: qty,
      lsa_threshold: lsa
    }
  };
  if (productId) payload.related_product_id = productId;
  return payload;
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

async function insertSupplierAlert(payload) {
  const result = await insertNotification(payload, supabase);
  if (!result?.error) return true;
  if (payload.related_product_id) {
    const { related_product_id: _omit, ...withoutProduct } = payload;
    const retry = await insertNotification(withoutProduct, supabase);
    if (!retry?.error) return true;
    console.error('[LowInventoryMovAlert] notification insert failed:', retry.error);
    return false;
  }
  console.error('[LowInventoryMovAlert] notification insert failed:', result.error);
  return false;
}

async function hasUnreadLsaNotification(supplierId, supplierProductId) {
  if (!supplierId || !supplierProductId) return false;
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', supplierId)
    .eq('is_read', false)
    .eq('type', 'system')
    .contains('metadata', {
      kind: 'inventory_below_lsa',
      supplier_product_id: supplierProductId
    })
    .limit(1);
  if (error) {
    console.error('[LowInventoryMovAlert] unread LSA lookup failed:', error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * When stock decreases, notify the supplier if inventory value (stock × unit price)
 * crosses from at/above their profile minimum order value (MOV) to strictly below it.
 * Also notifies when on-hand stock hits the variant Low Stock Alert (LSA).
 */
export async function maybeNotifyInventoryBelowMov({
  supplierId,
  supplierProductId,
  previousStock,
  newStock,
  quantityChange,
  previousLsaThreshold
}) {
  try {
    if (!supplierId || !supplierProductId) return;
    const qtyCh = Number(quantityChange);
    const prev = Math.max(0, parseInt(previousStock, 10) || 0);
    const next = Math.max(0, parseInt(newStock, 10) || 0);
    const stockDecreased = Number.isFinite(qtyCh) ? qtyCh < 0 : next < prev;
    const lsaConfigChanged = previousLsaThreshold !== undefined;

    if (!stockDecreased && !lsaConfigChanged) return;

    const { data: sp } = await supabase
      .from('supplier_products')
      .select('id, price, product_id, attributes')
      .eq('id', supplierProductId)
      .maybeSingle();

    if (!sp) return;

    const { data: prod } = await supabase
      .from('products')
      .select('name, specifications')
      .eq('id', sp.product_id)
      .maybeSingle();

    const attrs = parseSupplierOfferAttributes(sp.attributes);
    const name =
      attrs.listingName != null && String(attrs.listingName).trim() !== ''
        ? String(attrs.listingName).trim()
        : prod?.name || 'Product';

    const lsaThreshold = resolveLsaThreshold(attrs, prod);
    if (
      shouldNotifyLsaHit({
        previousStock: prev,
        newStock: next,
        lsaThreshold,
        previousLsaThreshold
      })
    ) {
      const crossed = crossedLsaThreshold({ previousStock: prev, newStock: next, lsaThreshold });
      const alreadyNotified =
        !crossed && (await hasUnreadLsaNotification(supplierId, supplierProductId));
      if (!alreadyNotified) {
        await insertSupplierAlert(
          buildLsaNotificationPayload({
            supplierId,
            productId: sp.product_id,
            supplierProductId,
            productName: name,
            previousStock: prev,
            newStock: next,
            lsaThreshold
          })
        );
      }
    }

    if (!stockDecreased) return;

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

    const nextValue = roundInr(next * unitPrice);
    if (!crossedInventoryBelowMov({ previousStock: prev, newStock: next, unitPrice, movThreshold: threshold })) {
      return;
    }

    const formattedMov = threshold.toLocaleString('en-IN');
    const formattedVal = nextValue.toLocaleString('en-IN');

    await insertSupplierAlert({
      user_id: supplierId,
      type: 'system',
      title: 'Low inventory vs minimum order value',
      message: `${name}: inventory value is ₹${formattedVal} (below your minimum order value of ₹${formattedMov}). Consider restocking.`,
      related_product_id: sp.product_id || undefined,
      is_read: false,
      metadata: {
        source: 'mov_alert',
        event: 'inventory_below_mov',
        kind: 'inventory_below_mov',
        supplier_product_id: supplierProductId,
        previous_stock: prev,
        new_stock: next,
        unit_price: unitPrice,
        inventory_value_inr: nextValue,
        minimum_order_value_inr: threshold
      }
    });
  } catch (e) {
    console.error('[LowInventoryMovAlert]', e);
  }
}
