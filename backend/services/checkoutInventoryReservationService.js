import { supabase } from '../config/supabase.js';
import { parseServerDate } from '../utils/dateTime.js';
import {
  expireReservations,
  reserveInventory,
  settleReservation
} from './phase2CoreService.js';

function parseCheckoutReservationMinutes() {
  const parsed = parseInt(String(process.env.CHECKOUT_RESERVATION_MINUTES ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

export const CHECKOUT_RESERVATION_MINUTES = parseCheckoutReservationMinutes();

export const CHECKOUT_SOURCES = {
  UPSTREAM: 'upstream_checkout',
  SP_PO: 'sp_po_checkout'
};

/** @deprecated use CHECKOUT_RESERVATION_MINUTES */
export const UPSTREAM_CHECKOUT_RESERVATION_MINUTES = CHECKOUT_RESERVATION_MINUTES;

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function lineSupplierProductId(line = {}) {
  return String(line?.supplierProductId || line?.upstreamSupplierProductId || '').trim();
}

function isCheckoutReservation(row, source) {
  return String(row?.metadata?.source || '') === source;
}

function dedupeCheckoutLinesByProduct(lines = []) {
  const map = new Map();
  for (const line of lines) {
    const supplierProductId = lineSupplierProductId(line);
    const quantity = safeNumber(line?.quantity);
    if (!supplierProductId || quantity <= 0) continue;

    const existing = map.get(supplierProductId);
    if (existing) {
      existing.quantity = safeNumber(existing.quantity) + quantity;
      continue;
    }
    map.set(supplierProductId, { ...line, quantity });
  }
  return [...map.values()];
}

function dedupeCheckoutLines(lines = []) {
  return dedupeCheckoutLinesByProduct(lines);
}

function lineQuantitiesByProduct(lines = []) {
  const map = new Map();
  for (const line of lines) {
    const supplierProductId = lineSupplierProductId(line);
    map.set(supplierProductId, safeNumber(map.get(supplierProductId)) + safeNumber(line?.quantity));
  }
  return map;
}

function reservationsMatchLines(rows = [], lines = []) {
  const needed = lineQuantitiesByProduct(lines);
  if (!needed.size) return false;

  const held = new Map();
  for (const row of rows) {
    const key = row.supplier_product_id;
    held.set(key, safeNumber(held.get(key)) + safeNumber(row.reserved_quantity));
  }

  for (const [supplierProductId, quantity] of needed.entries()) {
    if (safeNumber(held.get(supplierProductId)) !== quantity) {
      return false;
    }
  }

  for (const supplierProductId of held.keys()) {
    if (!needed.has(supplierProductId)) {
      return false;
    }
  }

  return true;
}

export async function expireStaleReservations(filters = {}) {
  return expireReservations(filters);
}

/** @internal test export */
export function dedupeCheckoutLinesByProductForTest(lines = []) {
  return dedupeCheckoutLinesByProduct(lines);
}

/** @internal test export */
export function reservationsMatchLinesForTest(rows = [], lines = []) {
  return reservationsMatchLines(rows, lines);
}

export async function getActiveReservedQuantitiesByProductIds(supplierProductIds = []) {
  const ids = [...new Set((supplierProductIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  // Scoped sweep: this runs on hot read paths (e.g. once per BOQ line during vendor ranking),
  // so it must never scan every active reservation platform-wide. Bounding it to the handful of
  // supplier_product_ids actually being asked about keeps cost proportional to the request, not
  // to total platform traffic. The `isReservationStillActive` filter below already excludes
  // clock-expired rows from the count even if the sweep hasn't physically settled them yet.
  await expireStaleReservations({ supplierProductIds: ids });

  const { data, error } = await supabase
    .from('inventory_reservations')
    .select('supplier_product_id, reserved_quantity, expires_at, status')
    .in('supplier_product_id', ids)
    .eq('status', 'active');
  if (error) throw error;

  const map = new Map();
  (data || []).forEach((row) => {
    if (!isReservationStillActive(row)) return;
    const key = row.supplier_product_id;
    map.set(key, safeNumber(map.get(key)) + safeNumber(row.reserved_quantity));
  });
  return map;
}

export function computeAvailableStock(onHandStock, reservedQty = 0) {
  // Holds reduce supplier_products.stock when created; reservedQty is informational only.
  void reservedQty;
  return Math.max(0, safeNumber(onHandStock));
}

function normalizeReservationExpiresAt(value) {
  const parsed = parseServerDate(value);
  return parsed ? parsed.toISOString() : null;
}

function isReservationStillActive(row) {
  const expiresAt = parseServerDate(row?.expires_at);
  if (!expiresAt) return true;
  return expiresAt.getTime() > Date.now();
}

async function loadCheckoutReservationsForBuyer(
  buyerUserId,
  source,
  checkoutSessionId = null,
  { includeClockExpired = false } = {}
) {
  // Scoped to this buyer only — settling their expired holds (to restock stock correctly)
  // never requires touching other buyers' active reservations.
  await expireStaleReservations({ buyerUserId });
  const { data, error } = await supabase
    .from('inventory_reservations')
    .select('*')
    .eq('created_by', buyerUserId)
    .eq('status', 'active');
  if (error) throw error;

  return (data || []).filter((row) => {
    if (!isCheckoutReservation(row, source)) return false;
    if (checkoutSessionId && String(row?.metadata?.checkoutSessionId || '') !== checkoutSessionId) {
      return false;
    }
    if (!includeClockExpired && !isReservationStillActive(row)) return false;
    return true;
  });
}

async function loadActiveCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId = null) {
  return loadCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId, {
    includeClockExpired: false
  });
}

async function releaseReservationRows(rows, actorUserId) {
  for (const row of rows) {
    if (row.status !== 'active') continue;
    const mode = isReservationStillActive(row) ? 'release' : 'expire';
    await settleReservation({
      reservationId: row.id,
      mode,
      actorUserId: actorUserId || row.created_by
    });
  }
}

export async function releaseCheckoutReservations({
  buyerUserId,
  source,
  checkoutSessionId = null,
  actorUserId = null
}) {
  const rows = await loadCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId, {
    includeClockExpired: true
  });
  await releaseReservationRows(rows, actorUserId || buyerUserId);
  return { released: rows.length };
}

export async function reserveCheckoutLines({
  buyerUserId,
  source,
  checkoutSessionId,
  lines = []
}) {
  if (!buyerUserId || !checkoutSessionId || !source) {
    throw new Error('buyerUserId, source, and checkoutSessionId are required');
  }

  const normalizedLines = dedupeCheckoutLinesByProduct(lines);
  if (!normalizedLines.length) {
    throw new Error('At least one line is required to reserve inventory');
  }

  // loadActiveCheckoutReservationsForBuyer below already sweeps this buyer's expired rows
  // (scoped, not platform-wide) before reading — no separate unscoped sweep needed here.
  const existing = await loadActiveCheckoutReservationsForBuyer(buyerUserId, source);
  const toRelease = existing.filter((row) => {
    const sessionId = String(row?.metadata?.checkoutSessionId || '');
    return sessionId !== checkoutSessionId;
  });
  await releaseReservationRows(toRelease, buyerUserId);

  const currentSessionRows = existing.filter(
    (row) => String(row?.metadata?.checkoutSessionId || '') === checkoutSessionId
  );
  if (currentSessionRows.length && reservationsMatchLines(currentSessionRows, normalizedLines)) {
    let expiresAt = null;
    for (const row of currentSessionRows) {
      const normalizedExpiry = normalizeReservationExpiresAt(row.expires_at);
      if (!expiresAt || (normalizedExpiry && normalizedExpiry < expiresAt)) {
        expiresAt = normalizedExpiry || row.expires_at;
      }
    }

    return {
      checkoutSessionId,
      reservations: currentSessionRows,
      expiresAt: normalizeReservationExpiresAt(expiresAt) || expiresAt,
      expiresInMinutes: CHECKOUT_RESERVATION_MINUTES
    };
  }

  await releaseReservationRows(currentSessionRows, buyerUserId);

  const reservations = [];
  let expiresAt = null;

  for (const line of normalizedLines) {
    const supplierProductId = lineSupplierProductId(line);
    const supplierId = String(line?.supplierId || '').trim();
    const quantity = safeNumber(line?.quantity);
    if (!supplierProductId || !supplierId || quantity <= 0) {
      throw new Error(
        'Each line requires upstreamSupplierProductId (or supplierProductId), supplierId, and positive quantity'
      );
    }

    const reservation = await reserveInventory({
      supplierProductId,
      supplierId,
      quantity,
      idempotencyKey: `${source}:${checkoutSessionId}:${supplierProductId}`,
      expiresInMinutes: CHECKOUT_RESERVATION_MINUTES,
      actorUserId: buyerUserId,
      metadata: {
        source,
        checkoutSessionId,
        mineSupplierProductId: line.mineSupplierProductId || null,
        productId: line.productId || null
      }
    });
    reservations.push(reservation);
    const normalizedExpiry = normalizeReservationExpiresAt(reservation.expires_at);
    if (!expiresAt || (normalizedExpiry && normalizedExpiry < expiresAt)) {
      expiresAt = normalizedExpiry || reservation.expires_at;
    }
  }

  return {
    checkoutSessionId,
    reservations,
    expiresAt: normalizeReservationExpiresAt(expiresAt) || expiresAt,
    expiresInMinutes: CHECKOUT_RESERVATION_MINUTES
  };
}

export async function getCheckoutReservationStatus({ buyerUserId, source, checkoutSessionId }) {
  const rows = await loadActiveCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId);
  const expiresAt = rows.reduce((min, row) => {
    const candidate = normalizeReservationExpiresAt(row.expires_at);
    if (!candidate) return min;
    if (!min || candidate < min) return candidate;
    return min;
  }, null);

  return {
    checkoutSessionId,
    active: rows.length > 0,
    expiresAt,
    expiresInMinutes: CHECKOUT_RESERVATION_MINUTES,
    reservations: rows.map((row) => ({
      id: row.id,
      supplierProductId: row.supplier_product_id,
      supplierId: row.supplier_id,
      reservedQuantity: row.reserved_quantity,
      expiresAt: row.expires_at
    }))
  };
}

export async function validateCheckoutReservationsForLines({
  buyerUserId,
  source,
  checkoutSessionId,
  lines = []
}) {
  const normalizedLines = dedupeCheckoutLinesByProduct(lines);
  const sessionRows = await loadActiveCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId);
  if (!sessionRows.length) {
    throw new Error(
      `Your inventory hold has expired. Return to your cart and proceed again within ${CHECKOUT_RESERVATION_MINUTES} minutes.`
    );
  }

  if (!reservationsMatchLines(sessionRows, normalizedLines)) {
    throw new Error(
      'One or more items are no longer held in inventory. Return to your cart and proceed again.'
    );
  }

  return sessionRows;
}

export async function consumeCheckoutReservationsForOrder({
  buyerUserId,
  source,
  checkoutSessionId,
  lines = [],
  orderItemBySupplierProductId = {},
  skipExpireStale = false,
  requireEmptySession = false
} = {}) {
  if (!skipExpireStale) {
    await expireStaleReservations({ buyerUserId });
  }
  const normalizedLines = dedupeCheckoutLinesByProduct(lines);
  if (!normalizedLines.length) {
    throw new Error('No valid checkout lines for inventory consume');
  }
  const sessionRows = await loadActiveCheckoutReservationsForBuyer(buyerUserId, source, checkoutSessionId);
  const byProductId = new Map(sessionRows.map((row) => [row.supplier_product_id, row]));

  const consumed = [];
  for (const line of normalizedLines) {
    const supplierProductId = lineSupplierProductId(line);
    const quantity = safeNumber(line?.quantity);
    const reservation = byProductId.get(supplierProductId);
    if (!reservation) {
      throw new Error(
        'One or more items are no longer held in inventory. Return to supplier selection and try again.'
      );
    }
    if (safeNumber(reservation.reserved_quantity) !== quantity) {
      throw new Error(
        'Reserved quantity does not match the order quantity for one or more items.'
      );
    }

    const orderItem = orderItemBySupplierProductId[supplierProductId];
    if (orderItem?.orderId) {
      await supabase
        .from('inventory_reservations')
        .update({
          order_id: orderItem.orderId,
          order_item_id: orderItem.orderItemId || null,
          updated_at: nowIso()
        })
        .eq('id', reservation.id);
    }

    const settled = await settleReservation({
      reservationId: reservation.id,
      mode: 'consume',
      actorUserId: buyerUserId
    });
    consumed.push(settled);
    byProductId.delete(supplierProductId);
  }

  if (requireEmptySession && byProductId.size > 0) {
    throw new Error('Checkout inventory holds could not be matched to all order lines');
  }

  return consumed;
}
