import { supabase } from '../config/supabase.js';
import { recordInventoryMovement } from './inventoryService.js';
import { parseServerDate } from '../utils/dateTime.js';
import {
  LIFECYCLE_STATES,
  toLifecycleStateFromStatus,
  toPrimaryStatusFromLifecycle
} from '../utils/orderLifecycle.js';

const ALLOWED_TRANSITIONS = {
  draft: ['confirmed'],
  confirmed: ['packed', 'returned'],
  packed: ['shipped', 'returned'],
  shipped: ['delivered', 'returned'],
  delivered: ['settled', 'returned'],
  settled: ['returned'],
  returned: [],
  cancelled: []
};

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function computeAttributeCompleteness(product = {}) {
  const fields = [
    product?.name,
    product?.description,
    product?.category,
    product?.unit,
    product?.specifications && Object.keys(product.specifications).length > 0 ? 'ok' : '',
    product?.images && Array.isArray(product.images) && product.images.length > 0 ? 'ok' : ''
  ];
  const filled = fields.filter((x) => String(x || '').trim()).length;
  return Number(((filled / fields.length) * 100).toFixed(2));
}

function jaccardTokens(a, b) {
  const setA = new Set(String(a || '').toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(String(b || '').toLowerCase().split(/\s+/).filter(Boolean));
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  setA.forEach((t) => {
    if (setB.has(t)) inter += 1;
  });
  const union = new Set([...setA, ...setB]).size;
  return union ? inter / union : 0;
}

export function computeDuplicateConfidence(productA, productB) {
  const nameScore = jaccardTokens(productA?.name, productB?.name);
  const categoryScore = (String(productA?.category || '').toLowerCase() === String(productB?.category || '').toLowerCase()) ? 1 : 0;
  const brandA = String(productA?.specifications?.brand || productA?.brand || '').toLowerCase();
  const brandB = String(productB?.specifications?.brand || productB?.brand || '').toLowerCase();
  const brandScore = brandA && brandB && brandA === brandB ? 1 : 0;
  return Number((((nameScore * 0.6) + (categoryScore * 0.25) + (brandScore * 0.15)) * 100).toFixed(2));
}

export async function refreshProductCompleteness({ productIds = [] } = {}) {
  let query = supabase.from('products').select('id, name, description, category, unit, specifications, images');
  if (Array.isArray(productIds) && productIds.length > 0) {
    query = query.in('id', productIds);
  }
  const { data: products, error } = await query;
  if (error) throw error;

  const rows = (products || []).map((p) => ({
    id: p.id,
    attribute_completeness_score: computeAttributeCompleteness(p),
    normalization_last_reviewed_at: nowIso()
  }));
  if (!rows.length) return { updated: 0 };

  for (const row of rows) {
    // Upsert-by-update keeps this compatible with existing rows.
    await supabase.from('products').update(row).eq('id', row.id);
  }

  return { updated: rows.length };
}

export async function buildNormalizationTriageQueue({ threshold = 70, limit = 200 } = {}) {
  const { data: rows, error } = await supabase
    .from('products')
    .select('id, name, category, normalization_confidence, attribute_completeness_score, normalization_last_reviewed_at')
    .or(`normalization_confidence.lt.${Number(threshold)},normalization_confidence.is.null`)
    .order('normalization_last_reviewed_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  return rows || [];
}

function checkoutHoldMovementNote(reservationId) {
  return `Checkout inventory hold:${reservationId}`;
}

function checkoutHoldReleaseMovementNote(reservationId) {
  return `Checkout hold released:${reservationId}`;
}

async function loadSupplierProductForReservation(supplierProductId) {
  const { data: sp, error } = await supabase
    .from('supplier_products')
    .select('product_id')
    .eq('id', supplierProductId)
    .maybeSingle();
  if (error) throw error;
  return sp;
}

async function deductStockForReservation(row, actorUserId) {
  const sp = await loadSupplierProductForReservation(row.supplier_product_id);
  if (!sp?.product_id) return false;

  const holdNote = checkoutHoldMovementNote(row.id);
  const { data: existingHold } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('supplier_product_id', row.supplier_product_id)
    .eq('notes', holdNote)
    .maybeSingle();
  if (existingHold) return false;

  await recordInventoryMovement({
    supplierProductId: row.supplier_product_id,
    supplierId: row.supplier_id,
    productId: sp.product_id,
    quantityChange: -safeNumber(row.reserved_quantity),
    movementType: 'adjustment',
    referenceOrderId: row.order_id || null,
    referenceOrderItemId: row.order_item_id || null,
    notes: holdNote,
    userId: actorUserId || row.created_by || row.supplier_id
  });
  return true;
}

async function restockFromReservation(row, actorUserId, notes) {
  const sp = await loadSupplierProductForReservation(row.supplier_product_id);
  if (!sp?.product_id) return;

  const releaseNote = checkoutHoldReleaseMovementNote(row.id);
  const { data: existingRelease } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('supplier_product_id', row.supplier_product_id)
    .eq('notes', releaseNote)
    .maybeSingle();
  if (existingRelease) return;

  const reservedQty = safeNumber(row.reserved_quantity);
  if (reservedQty <= 0) return;

  await recordInventoryMovement({
    supplierProductId: row.supplier_product_id,
    supplierId: row.supplier_id,
    productId: sp.product_id,
    quantityChange: reservedQty,
    movementType: 'adjustment',
    referenceOrderId: row.order_id || null,
    referenceOrderItemId: row.order_item_id || null,
    notes: notes || releaseNote,
    userId: actorUserId || row.created_by || row.supplier_id
  });
}

export async function reconcileActivePhysicalHolds() {
  // Holds are applied once at reserve time via idempotent deductStockForReservation.
  return { repaired: 0 };
}

/**
 * True only if an existing reservation row can be safely handed back as "the" hold for its
 * idempotency key: it must still be active AND not past its expiry. A row that was
 * consumed/released/expired (by checkout completing, a re-reserve releasing it, or the sweep)
 * is settled and final — its `expires_at` is stale and must never be resurrected.
 */
export function isReservationRowStillHoldable(row) {
  if (!row || row.status !== 'active') return false;
  const expiresAt = parseServerDate(row.expires_at);
  return !expiresAt || expiresAt.getTime() > Date.now();
}

/**
 * Free a settled row's idempotency_key (unique) so a brand-new hold can be inserted with the
 * same key. The settled row itself is left untouched — it has already gone through its final
 * stock side effects and must not be mutated.
 */
async function supersedeStaleIdempotencyKey(row) {
  const supersededKey = `${row.idempotency_key}::superseded:${row.id}`;
  await supabase
    .from('inventory_reservations')
    .update({ idempotency_key: supersededKey })
    .eq('id', row.id)
    .eq('idempotency_key', row.idempotency_key);
}

export async function reserveInventory({
  supplierProductId,
  supplierId,
  quantity,
  orderId = null,
  orderItemId = null,
  idempotencyKey = null,
  expiresInMinutes = 30,
  actorUserId = null,
  metadata = {}
}) {
  const qty = safeNumber(quantity);
  if (!supplierProductId || !supplierId || qty <= 0) {
    throw new Error('supplierProductId, supplierId and positive quantity are required');
  }

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('inventory_reservations')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) {
      if (isReservationRowStillHoldable(existing)) return existing;
      // A prior hold under this exact key was already settled (e.g. released moments ago by a
      // re-reserve in the same checkout session). Returning it here previously handed the
      // caller a hold that looked seconds-from-expiry (or already expired) even though the new
      // hold hadn't been created yet. Free the key and fall through to create a fresh one.
      await supersedeStaleIdempotencyKey(existing);
    }
  }

  const { data: current, error: stockErr } = await supabase
    .from('supplier_products')
    .select('id, product_id, stock')
    .eq('id', supplierProductId)
    .eq('supplier_id', supplierId)
    .single();
  if (stockErr || !current) throw new Error('Supplier product not found');

  // Stock is reduced when a hold is created, so on-hand stock is the true availability.
  const available = Math.max(0, safeNumber(current.stock));
  if (available < qty) {
    throw new Error(`Insufficient available stock. Available=${available}, requested=${qty}`);
  }

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const reservationMetadata = {
    ...metadata,
    physicalHold: true,
    stockBeforeHold: safeNumber(current.stock)
  };
  const insertRow = {
    idempotency_key: idempotencyKey,
    supplier_product_id: supplierProductId,
    supplier_id: supplierId,
    order_id: orderId,
    order_item_id: orderItemId,
    reserved_quantity: qty,
    status: 'active',
    expires_at: expiresAt,
    metadata: reservationMetadata,
    created_by: actorUserId || supplierId
  };

  let created;
  try {
    const { data, error: insertErr } = await supabase
      .from('inventory_reservations')
      .insert(insertRow)
      .select('*')
      .single();
    if (insertErr) throw insertErr;
    created = data;
  } catch (insertErr) {
    // Two concurrent requests can both pass the "no existing row" check above and race to
    // insert under the same idempotency key (common at high concurrency — e.g. a double-click
    // or duplicate network retry). Postgres's unique constraint lets exactly one insert win;
    // the loser should adopt that winner's hold instead of failing the whole checkout.
    if (idempotencyKey && insertErr?.code === '23505') {
      const { data: racedRow } = await supabase
        .from('inventory_reservations')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (racedRow && isReservationRowStillHoldable(racedRow)) return racedRow;
    }
    throw insertErr;
  }

  try {
    await deductStockForReservation(created, actorUserId);
  } catch (deductErr) {
    await supabase.from('inventory_reservations').delete().eq('id', created.id);
    throw deductErr;
  }

  return created;
}

export async function settleReservation({ reservationId, mode = 'consume', actorUserId = null }) {
  const { data: row, error } = await supabase
    .from('inventory_reservations')
    .select('*')
    .eq('id', reservationId)
    .maybeSingle();
  if (error || !row) throw new Error('Reservation not found');
  if (row.status !== 'active') return row;

  const physicalHold = row.metadata?.physicalHold === true;
  const nextStatus = mode === 'consume' ? 'consumed' : mode === 'expire' ? 'expired' : 'released';

  // Claim settlement before restock/consume side effects so concurrent expire sweeps
  // cannot double-restore stock for the same reservation.
  const { data: updated, error: updErr } = await supabase
    .from('inventory_reservations')
    .update({
      status: nextStatus,
      updated_at: nowIso(),
      metadata: { ...(row.metadata || {}), settledBy: actorUserId || null, settledAt: nowIso() }
    })
    .eq('id', row.id)
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) return row;

  if ((mode === 'release' || mode === 'expire') && physicalHold) {
    await restockFromReservation(updated, actorUserId, checkoutHoldReleaseMovementNote(updated.id));
  }

  if (nextStatus === 'consumed' && !physicalHold) {
    const sp = await loadSupplierProductForReservation(row.supplier_product_id);
    if (sp?.product_id) {
      await recordInventoryMovement({
        supplierProductId: row.supplier_product_id,
        supplierId: row.supplier_id,
        productId: sp.product_id,
        quantityChange: -safeNumber(row.reserved_quantity),
        movementType: 'sale_online',
        referenceOrderId: row.order_id || null,
        referenceOrderItemId: row.order_item_id || null,
        notes: 'Inventory consumed from active reservation',
        userId: actorUserId || row.created_by || row.supplier_id
      });
    }
  }

  return updated;
}

/** Settle a batch of expired rows with bounded parallelism (each settle is a few round-trips). */
async function settleExpiredRowsConcurrently(rows, concurrency = 10) {
  let cursor = 0;
  let settledCount = 0;

  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= rows.length) return;
      try {
        await settleReservation({ reservationId: rows[i].id, mode: 'expire', actorUserId: null });
        settledCount += 1;
      } catch (err) {
        console.error('[Reservations] Failed to expire reservation', rows[i]?.id, err?.message || err);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, rows.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return settledCount;
}

/**
 * Settle every reservation whose hold has passed its `expires_at`.
 *
 * At scale this must never load "all active reservations" — that set grows with total
 * platform traffic and gets re-scanned in JS on every call. Instead we filter to already-expired
 * rows directly in the query (`status = active AND expires_at <= now`), which stays small and
 * indexable regardless of how many holds are currently in flight. Callers on hot read paths
 * (e.g. computing reserved quantity for a handful of products during vendor ranking) can pass
 * `supplierProductIds`/`buyerUserId` to bound the sweep to just what they need instead of
 * touching the whole table.
 */
export async function expireReservations({ buyerUserId = null, supplierId = null, supplierProductIds = null } = {}) {
  let query = supabase
    .from('inventory_reservations')
    .select('*')
    .eq('status', 'active')
    .lte('expires_at', nowIso());
  if (buyerUserId) query = query.eq('created_by', buyerUserId);
  if (supplierId) query = query.eq('supplier_id', supplierId);
  if (Array.isArray(supplierProductIds) && supplierProductIds.length > 0) {
    query = query.in('supplier_product_id', supplierProductIds);
  }

  const { data: expired, error } = await query;
  if (error) throw error;
  if (!expired || expired.length === 0) return { expired: 0 };

  const count = await settleExpiredRowsConcurrently(expired);
  return { expired: count };
}

export async function transitionOrderState({
  orderId,
  nextState,
  actorUserId,
  notes = ''
}) {
  if (!LIFECYCLE_STATES.includes(nextState)) throw new Error('Invalid target order state');

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, status, lifecycle_state, status_history')
    .eq('id', orderId)
    .single();
  if (error || !order) throw new Error('Order not found');

  const current = order.lifecycle_state || toLifecycleStateFromStatus(order.status) || 'draft';
  if (!ALLOWED_TRANSITIONS[current]?.includes(nextState)) {
    throw new Error(`Invalid transition ${current} -> ${nextState}`);
  }

  const history = Array.isArray(order.status_history) ? order.status_history : [];
  history.push({
    status: nextState,
    updatedBy: actorUserId || null,
    notes: notes || `Transitioned from ${current} to ${nextState}`,
    timestamp: nowIso()
  });

  const update = {
    status: toPrimaryStatusFromLifecycle(nextState),
    lifecycle_state: nextState,
    status_history: history
  };
  if (nextState === 'delivered') {
    update.actual_delivery_date = nowIso();
  }

  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', orderId)
    .select('*')
    .single();
  if (updateError) throw updateError;
  return updated;
}

export async function upsertReturnPolicyDecision({
  returnId,
  disposition = 'pending',
  restockedQuantity = 0,
  policySnapshot = {},
  actorUserId = null
}) {
  const { data: existing, error } = await supabase
    .from('order_returns')
    .select('*')
    .eq('id', returnId)
    .single();
  if (error || !existing) throw new Error('Return request not found');

  const history = Array.isArray(existing.status_history) ? existing.status_history : [];
  history.push({
    status: existing.status,
    by: actorUserId || null,
    note: `Return policy evaluated, disposition=${disposition}`,
    at: nowIso()
  });

  const { data: updated, error: updErr } = await supabase
    .from('order_returns')
    .update({
      policy_snapshot: policySnapshot,
      disposition,
      restocked_quantity: safeNumber(restockedQuantity),
      processed_at: nowIso(),
      status_history: history
    })
    .eq('id', returnId)
    .select('*')
    .single();
  if (updErr) throw updErr;

  if (safeNumber(restockedQuantity) > 0 && disposition === 'restock') {
    const { data: orderItem } = await supabase
      .from('order_items')
      .select('id, product_id, supplier_product_id, order_id')
      .eq('id', existing.order_item_id)
      .maybeSingle();
    if (orderItem?.supplier_product_id && orderItem?.product_id) {
      await recordInventoryMovement({
        supplierProductId: orderItem.supplier_product_id,
        supplierId: existing.supplier_id,
        productId: orderItem.product_id,
        quantityChange: safeNumber(restockedQuantity),
        movementType: 'return_sale',
        referenceOrderId: orderItem.order_id || existing.order_id,
        referenceOrderItemId: orderItem.id,
        notes: 'Partial return restock',
        userId: actorUserId || existing.supplier_id
      });
    }
  }

  return updated;
}

export async function computeBaselineKpis({ fromDate = null, toDate = null } = {}) {
  let orderQuery = supabase
    .from('orders')
    .select('id, supplier_id, created_at, expected_delivery_date, actual_delivery_date, status, total_amount');
  if (fromDate) orderQuery = orderQuery.gte('created_at', fromDate);
  if (toDate) orderQuery = orderQuery.lte('created_at', toDate);
  const { data: orders } = await orderQuery;
  const orderList = orders || [];

  let orderItemQuery = supabase
    .from('order_items')
    .select('id, order_id, quantity, supplier_product_id');
  const { data: orderItems } = await orderItemQuery;
  const itemList = orderItems || [];

  const { data: returns } = await supabase
    .from('order_returns')
    .select('id, created_at, processed_at, supplier_id, quantity, order_id, status');

  const { data: movements } = await supabase
    .from('inventory_movements')
    .select('id, supplier_id, movement_type, quantity_change, created_at');

  const { data: activeReservations } = await supabase
    .from('inventory_reservations')
    .select('supplier_product_id, reserved_quantity')
    .eq('status', 'active');

  const delivered = orderList.filter((o) => o.status === 'delivered');
  const onTime = delivered.filter((o) => {
    if (!o.expected_delivery_date || !o.actual_delivery_date) return false;
    return new Date(o.actual_delivery_date).getTime() <= new Date(o.expected_delivery_date).getTime();
  });

  const reservationByProduct = new Map();
  (activeReservations || []).forEach((r) => {
    reservationByProduct.set(r.supplier_product_id, safeNumber(reservationByProduct.get(r.supplier_product_id)) + safeNumber(r.reserved_quantity));
  });
  const oversellCandidates = itemList.filter((it) => safeNumber(it.quantity) > safeNumber(reservationByProduct.get(it.supplier_product_id)));

  const returnsTAT = (returns || [])
    .filter((r) => r.processed_at && r.created_at)
    .map((r) => (new Date(r.processed_at).getTime() - new Date(r.created_at).getTime()) / 3600000);
  const avgReturnsTatHours = returnsTAT.length ? Number((returnsTAT.reduce((a, b) => a + b, 0) / returnsTAT.length).toFixed(2)) : 0;

  const supplierStats = new Map();
  orderList.forEach((o) => {
    if (!o.supplier_id) return;
    const entry = supplierStats.get(o.supplier_id) || { orders: 0, onTime: 0 };
    entry.orders += 1;
    if (o.status === 'delivered' && o.expected_delivery_date && o.actual_delivery_date) {
      if (new Date(o.actual_delivery_date) <= new Date(o.expected_delivery_date)) entry.onTime += 1;
    }
    supplierStats.set(o.supplier_id, entry);
  });
  (movements || []).forEach((m) => {
    if (!m.supplier_id) return;
    const entry = supplierStats.get(m.supplier_id) || { orders: 0, onTime: 0, stockoutSignals: 0 };
    if (m.movement_type === 'adjustment' && safeNumber(m.quantity_change) > 0) {
      entry.stockoutSignals = safeNumber(entry.stockoutSignals) + 1;
    }
    supplierStats.set(m.supplier_id, entry);
  });

  return {
    fromDate,
    toDate,
    totals: {
      orders: orderList.length,
      deliveredOrders: delivered.length,
      slaOnTimePct: delivered.length ? Number(((onTime.length / delivered.length) * 100).toFixed(2)) : 0,
      returnsCount: (returns || []).length,
      avgReturnsTatHours,
      potentialOversellSignals: oversellCandidates.length
    },
    suppliers: Array.from(supplierStats.entries()).map(([supplierId, s]) => ({
      supplierId,
      orderCount: safeNumber(s.orders),
      onTimeOrders: safeNumber(s.onTime),
      leadTimeReliabilityPct: s.orders ? Number(((safeNumber(s.onTime) / safeNumber(s.orders)) * 100).toFixed(2)) : 0,
      fillRatePct: s.orders ? Number((100 - Math.min(100, safeNumber(s.stockoutSignals) * 3)).toFixed(2)) : 0
    }))
  };
}

export async function refreshVendorScorecards({ weekStart, weekEnd }) {
  const kpis = await computeBaselineKpis({ fromDate: weekStart, toDate: weekEnd });
  const rows = (kpis.suppliers || []).map((s) => ({
    supplier_id: s.supplierId,
    week_start: weekStart.slice(0, 10),
    week_end: weekEnd.slice(0, 10),
    total_orders: s.orderCount,
    on_time_orders: s.onTimeOrders,
    fill_rate: s.fillRatePct,
    avg_lead_time_hours: 0,
    price_variance_pct: 0,
    return_rate_pct: 0,
    score: Number(((s.leadTimeReliabilityPct * 0.5) + (s.fillRatePct * 0.5)).toFixed(2)),
    metrics: s
  }));
  if (!rows.length) return { generated: 0, rows: [] };

  const { data, error } = await supabase
    .from('vendor_scorecards')
    .upsert(rows, { onConflict: 'supplier_id,week_start,week_end' })
    .select('*');
  if (error) throw error;
  return { generated: (data || []).length, rows: data || [] };
}

export async function getWarehouseAllocation({ supplierProductId, quantity }) {
  const qty = safeNumber(quantity);
  if (!supplierProductId || qty <= 0) throw new Error('supplierProductId and positive quantity are required');

  const { data: stocks, error } = await supabase
    .from('warehouse_stock')
    .select('*')
    .eq('supplier_product_id', supplierProductId)
    .order('allocation_priority', { ascending: true });
  if (error) throw error;

  let remaining = qty;
  const plan = [];
  for (const row of (stocks || [])) {
    if (remaining <= 0) break;
    const available = safeNumber(row.available_qty);
    if (available <= 0) continue;
    const allocated = Math.min(remaining, available);
    plan.push({
      warehouseCode: row.warehouse_code,
      allocatedQuantity: allocated
    });
    remaining -= allocated;
  }

  return {
    requestedQuantity: qty,
    fulfilledQuantity: qty - remaining,
    unfulfilledQuantity: Math.max(0, remaining),
    allocations: plan
  };
}

export function evaluateReturnPolicy({ orderCreatedAt, categoryPolicyDays = 7, vendorPolicyDays = 7 }) {
  const createdAt = new Date(orderCreatedAt);
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const maxWindow = Math.min(safeNumber(categoryPolicyDays, 7), safeNumber(vendorPolicyDays, 7));
  return {
    allowed: ageDays <= maxWindow,
    ageDays: Number(ageDays.toFixed(2)),
    policyWindowDays: maxWindow
  };
}

export default {
  computeAttributeCompleteness,
  computeDuplicateConfidence,
  refreshProductCompleteness,
  buildNormalizationTriageQueue,
  reserveInventory,
  settleReservation,
  expireReservations,
  reconcileActivePhysicalHolds,
  transitionOrderState,
  upsertReturnPolicyDecision,
  computeBaselineKpis,
  refreshVendorScorecards,
  getWarehouseAllocation,
  evaluateReturnPolicy
};
