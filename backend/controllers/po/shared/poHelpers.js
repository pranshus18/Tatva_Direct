import { randomUUID } from 'node:crypto';
import { supabase } from '../../../config/supabase.js';
import { recordInventoryMovement } from '../../../services/inventoryService.js';

export const LEGACY_PO_CART_GROUP_PREFIX = 'legacy';
export const ORDER_INSERT_MAX_RETRIES = 3;
export const ADDRESS_REQUIRED_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];
export const MAX_CART_ITEM_QUANTITY = 1000000000;
export const PAYMENT_METHODS_ALLOWED = new Set([
  'cash',
  'bank_transfer',
  'online',
  'credit',
  'upi',
  'card'
]);

/** Map service-provider PO checkout choice to DB columns (aligns with POS / invoices). */
export function resolveB2bPaymentFromBody(body) {
  const raw = String(body?.paymentMethod || body?.payment_method || 'online')
    .toLowerCase()
    .trim();
  const allowed = new Set(['cod', 'online', 'bank_transfer', 'credit', 'card']);
  const choice = allowed.has(raw) ? raw : 'online';
  if (choice === 'cod') {
    return { payment_method: 'cash', payment_status: 'pending' };
  }
  if (choice === 'bank_transfer') {
    return { payment_method: 'bank_transfer', payment_status: 'pending' };
  }
  if (choice === 'credit') {
    return { payment_method: 'credit', payment_status: 'pending' };
  }
  if (choice === 'card') {
    return { payment_method: 'card', payment_status: 'pending' };
  }
  return { payment_method: 'online', payment_status: 'pending' };
}

export function normalizeAddress(address = {}) {
  return {
    line1: String(address?.line1 || address?.street || '').trim(),
    city: String(address?.city || '').trim(),
    state: String(address?.state || '').trim(),
    pincode: String(
      address?.pincode ||
        address?.zipCode ||
        address?.postalCode ||
        address?.postal_code ||
        ''
    ).trim(),
    country: String(address?.country || 'India').trim() || 'India'
  };
}

export function isAddressComplete(address = {}) {
  return ADDRESS_REQUIRED_FIELDS.every((field) => String(address?.[field] || '').trim());
}

export function mapToDeliveryAddress(address = {}) {
  return {
    street: address.line1,
    city: address.city,
    state: address.state,
    zipCode: address.pincode,
    country: address.country
  };
}

export function newPoCartGroupId() {
  try {
    return randomUUID();
  } catch {
    return `g-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * Optional merge of rows that share the same productId (legacy cleanup). Not applied on cart load/add by default.
 */
export function consolidateDuplicateProductLines(boqGroups) {
  if (!Array.isArray(boqGroups) || boqGroups.length === 0) return [];

  const firstGroupByProduct = new Map();
  const mergedRowByProduct = new Map();
  const out = boqGroups.map((g) => ({
    ...g,
    items: []
  }));

  for (let gi = 0; gi < boqGroups.length; gi += 1) {
    const sourceItems = Array.isArray(boqGroups[gi]?.items) ? boqGroups[gi].items : [];
    for (const it of sourceItems) {
      const pid = String(it?.productId || '').trim();
      if (!pid) {
        out[gi].items.push({ ...it });
        continue;
      }
      if (!firstGroupByProduct.has(pid)) {
        firstGroupByProduct.set(pid, gi);
        const row = { ...it };
        mergedRowByProduct.set(pid, row);
        out[gi].items.push(row);
        continue;
      }
      const row = mergedRowByProduct.get(pid);
      row.quantity = Math.min(
        MAX_CART_ITEM_QUANTITY,
        (Number(row.quantity) || 0) + (Number(it.quantity) || 0)
      );
    }
  }

  return out.filter((g) => (g.items || []).length > 0);
}

export function isDiscoveryBoqGroup(group) {
  if (!group || typeof group !== 'object') return false;
  if (group.boqProject?.source === 'product_discovery') return true;
  return /^discovery\b/i.test(String(group.boqName || '').trim());
}

/**
 * Voice / discovery add: always a new cart project (group), even for the same product.
 * Quantity is exactly what the user asked on this add — not merged into prior lines.
 * @returns {{ boqGroups: object[], groupId: string }}
 */
export function appendDiscoveryItemAsNewProject(boqGroups, item, productName) {
  const groups = Array.isArray(boqGroups) ? [...boqGroups] : [];
  const label = String(productName || item?.name || 'Product').trim() || 'Product';
  const qty = Math.min(
    MAX_CART_ITEM_QUANTITY,
    Math.max(1, Math.floor(Number(item?.quantity) || 1))
  );
  const resultGroupId = `pd-group-${newPoCartGroupId()}`;
  const newGroup = {
    groupId: resultGroupId,
    createdAt: new Date().toISOString(),
    boqId: null,
    boqName: `Discovery - ${label}`,
    boqProject: { source: 'product_discovery' },
    selectedVendors: {},
    substitutions: [],
    items: [{ ...item, quantity: qty }]
  };
  return {
    // Newest discovery add first (top of cart).
    boqGroups: [newGroup, ...groups],
    groupId: resultGroupId
  };
}

export function normalizePoCartDraft(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      selectedVendors: {},
      substitutions: [],
      items: [],
      boqGroups: [],
      boqId: null,
      boqProject: null,
      requiredDate: null,
      paymentMethod: null,
      deliveryDestination: null,
      shippingAddress: null,
      billingAddress: null,
      gstin: null,
      poGroups: [],
      grandTotalAllPos: null
    };
  }
  const hasGroups = Array.isArray(raw.boqGroups) && raw.boqGroups.length > 0;
  if (hasGroups) {
    const boqGroups = raw.boqGroups.map((g) => ({
      ...g,
      items: Array.isArray(g?.items) ? [...g.items] : []
    }));
    const items = boqGroups.flatMap((g) => (Array.isArray(g?.items) ? g.items : []));
    const mergedSelected = { ...(raw.selectedVendors || {}) };
    boqGroups.forEach((g) => {
      if (g?.selectedVendors && typeof g.selectedVendors === 'object') {
        Object.assign(mergedSelected, g.selectedVendors);
      }
    });
    return {
      ...raw,
      boqGroups,
      items,
      selectedVendors: mergedSelected
    };
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) {
    return { ...raw, boqGroups: [], items: [] };
  }
  const groupId = raw.boqId ? `${LEGACY_PO_CART_GROUP_PREFIX}-${raw.boqId}` : newPoCartGroupId();
  return {
    ...raw,
    boqGroups: [
      {
        groupId,
        boqId: raw.boqId ?? null,
        boqName: null,
        boqProject: raw.boqProject ?? null,
        items: items.map((it) => ({ ...it })),
        selectedVendors: { ...(raw.selectedVendors || {}) },
        substitutions: Array.isArray(raw.substitutions) ? [...raw.substitutions] : []
      }
    ],
    items
  };
}

export function buildPoCartDraftFromSavePayload(payload) {
  let boqGroups = Array.isArray(payload.boqGroups) ? payload.boqGroups.map((g) => ({ ...g })) : [];
  if (boqGroups.length === 0) {
    const gid = payload.boqId ? `${LEGACY_PO_CART_GROUP_PREFIX}-${payload.boqId}` : newPoCartGroupId();
    boqGroups = [
      {
        groupId: gid,
        boqId: payload.boqId ?? null,
        boqName: null,
        boqProject: payload.boqProject ?? null,
        items: [...(payload.items || [])],
        selectedVendors: { ...(payload.selectedVendors || {}) },
        substitutions: [...(payload.substitutions || [])]
      }
    ];
  }
  const flatItems = boqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
  const mergedSelected = { ...(payload.selectedVendors || {}) };
  boqGroups.forEach((g) => {
    if (g?.selectedVendors && typeof g.selectedVendors === 'object') {
      Object.assign(mergedSelected, g.selectedVendors);
    }
  });
  return {
    selectedVendors: mergedSelected,
    substitutions: payload.substitutions || [],
    items: flatItems,
    boqGroups,
    boqId: boqGroups[0]?.boqId ?? null,
    boqProject: boqGroups[0]?.boqProject ?? null,
    requiredDate: payload.requiredDate ?? null,
    paymentMethod: payload.paymentMethod ?? null,
    deliveryDestination: payload.deliveryDestination ?? null,
    shippingAddress: payload.shippingAddress ?? null,
    billingAddress: payload.billingAddress ?? null,
    gstin: payload.gstin ?? null,
    poGroups: Array.isArray(payload.poGroups) ? payload.poGroups : [],
    grandTotalAllPos: payload.grandTotalAllPos ?? null
  };
}

export function isOrderNumberConflictError(error) {
  if (!error) return false;
  if (error.code === '23505') {
    const details = String(error.details || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();
    return details.includes('order_number') || message.includes('order_number');
  }
  return false;
}

export async function findServiceProviderOrderByIdentifier(orderIdentifier, serviceProviderId) {
  let { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('order_number', orderIdentifier)
    .eq('service_provider_id', serviceProviderId)
    .maybeSingle();

  if (!order) {
    const { data: orderById, error: orderByIdError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderIdentifier)
      .eq('service_provider_id', serviceProviderId)
      .maybeSingle();
    if (!orderByIdError && orderById) {
      order = orderById;
      orderError = null;
    }
  }
  return { order, orderError };
}

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
  if (String(order.status || '').toLowerCase() !== 'cancelled') return { ok: true, skipped: true };

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_id, supplier_product_id, quantity')
    .eq('order_id', orderId);

  for (const it of items || []) {
    const qty = parseFloat(it.quantity || 0) || 0;
    if (!qty || qty <= 0 || !it.supplier_product_id) continue;
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

export async function cancelOrderWithAtomicRestock({ orderId, actorUserId, cancelReason }) {
  const { data, error } = await supabase.rpc('cancel_order_with_restock_atomic', {
    p_order_id: orderId,
    p_actor_user_id: actorUserId,
    p_cancel_reason: cancelReason || null
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}
