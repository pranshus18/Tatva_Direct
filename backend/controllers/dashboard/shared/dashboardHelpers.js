import { supabase } from '../../../config/supabase.js';
import { recordInventoryMovement } from '../../../services/inventoryService.js';

export function normalizeOrderNumberForTracking(orderNumber = '') {
  const normalized = String(orderNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'ORDER';
}

export function buildReturnTrackingId(orderNumber = '', suffix = '') {
  const orderPart = normalizeOrderNumberForTracking(orderNumber);
  const base = `RET-${orderPart}`;
  if (!suffix) return base;
  return `${base}-${String(suffix).toUpperCase()}`;
}

export async function ensureUniqueReturnTrackingId({ preferredTrackingId = '', orderNumber = '' }) {
  const preferred = String(preferredTrackingId || '').trim();
  const baseGenerated = buildReturnTrackingId(orderNumber);
  const candidates = preferred ? [preferred, baseGenerated] : [baseGenerated];
  const maxSuffixAttempts = 1000;

  for (const candidate of candidates) {
    const { data: existing, error } = await supabase
      .from('order_returns')
      .select('id')
      .eq('tracking_id', candidate)
      .maybeSingle();
    if (!error && !existing) return candidate;
  }

  for (let i = 2; i <= maxSuffixAttempts; i += 1) {
    const candidate = buildReturnTrackingId(orderNumber, `R${i}`);
    const { data: existing, error } = await supabase
      .from('order_returns')
      .select('id')
      .eq('tracking_id', candidate)
      .maybeSingle();
    if (!error && !existing) return candidate;
  }

  return buildReturnTrackingId(orderNumber, Date.now().toString(36));
}

export function normalizeUserAddress(address = {}, profile = {}) {
  const branches = Array.isArray(profile?.branches) ? profile.branches : [];
  const firstBranch = branches.find((b) => b && typeof b === 'object') || {};
  const source = address && typeof address === 'object' ? address : {};

  const line1 = String(
    source.line1 || source.street || firstBranch.address || firstBranch.line1 || ''
  ).trim();
  const line2 = String(source.line2 || source.area || firstBranch.line2 || '').trim();
  const city = String(source.city || firstBranch.city || '').trim();
  const state = String(source.state || firstBranch.state || '').trim();
  const zipCode = String(
    source.zipCode || source.pincode || source.postalCode || firstBranch.zipCode || firstBranch.pincode || ''
  ).trim();
  const country = String(source.country || firstBranch.country || '').trim();

  return {
    ...source,
    street: line1,
    line1,
    line2,
    city,
    state,
    zipCode,
    pincode: zipCode,
    country
  };
}

export { isRevenueRecognizedOrder } from '../../../utils/salesMetrics.js';

export async function restockInventoryForCancelledOrder({ orderId, actorUserId }) {
  if (!orderId) return { ok: false, reason: 'missing_order_id' };

  const { data: existingRestock } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('reference_order_id', orderId)
    .eq('movement_type', 'adjustment')
    .ilike('notes', '%cancel_restock%')
    .limit(1);

  if (existingRestock && existingRestock.length > 0) {
    return { ok: true, already: true };
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, supplier_id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'order_not_found' };
  if (String(order.status || '') !== 'cancelled') return { ok: true, skipped: true };

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_id, supplier_product_id, quantity')
    .eq('order_id', orderId);

  for (const it of items || []) {
    const qty = parseFloat(it.quantity || 0) || 0;
    if (!qty || qty <= 0) continue;
    if (!it.supplier_product_id) continue;

    await recordInventoryMovement({
      supplierProductId: it.supplier_product_id,
      supplierId: order.supplier_id,
      productId: it.product_id,
      quantityChange: Math.round(qty),
      movementType: 'adjustment',
      referenceOrderId: orderId,
      referenceOrderItemId: it.id,
      notes: 'cancel_restock: inventory added back due to order cancellation',
      userId: actorUserId
    });
  }

  return { ok: true, already: false };
}

export function formatDate(date) {
  if (!date) return 'N/A';

  const orderDate = new Date(date);
  const day = String(orderDate.getDate()).padStart(2, '0');
  const month = String(orderDate.getMonth() + 1).padStart(2, '0');
  const year = orderDate.getFullYear();
  const hours = String(orderDate.getHours()).padStart(2, '0');
  const minutes = String(orderDate.getMinutes()).padStart(2, '0');
  const seconds = String(orderDate.getSeconds()).padStart(2, '0');

  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}
