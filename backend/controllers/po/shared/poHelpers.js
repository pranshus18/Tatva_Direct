import { randomUUID } from 'node:crypto';
import { supabase } from '../../../config/supabase.js';
import { recordInventoryMovement } from '../../../services/inventoryService.js';
import {
  coerceInboundPaymentMethod,
  isVaultPaymentMethod,
  toDbVaultPaymentMethod
} from '../../../utils/vaultPaymentMethod.js';

export const LEGACY_PO_CART_GROUP_PREFIX = 'legacy';
export const ORDER_INSERT_MAX_RETRIES = 3;
export const ADDRESS_REQUIRED_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];
export const MAX_CART_ITEM_QUANTITY = 1000000000;
export const PAYMENT_METHODS_ALLOWED = new Set(['vault']);

/** Map service-provider PO checkout choice to DB columns (aligns with POS / invoices). */
export function resolveB2bPaymentFromBody(body) {
  const raw = coerceInboundPaymentMethod(body?.paymentMethod || body?.payment_method || 'vault');
  if (isVaultPaymentMethod(raw) || !raw) {
    return { payment_method: toDbVaultPaymentMethod(), payment_status: 'pending' };
  }
  return { payment_method: toDbVaultPaymentMethod(), payment_status: 'pending' };
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

const SIGNUP_PLACEHOLDER_PINCODE = '000000';

function hasSignupPlaceholderCoreFields(address = {}) {
  const normalized = normalizeAddress(address);
  return (
    /^pending$/i.test(normalized.city) &&
    /^pending$/i.test(normalized.state) &&
    normalized.pincode === SIGNUP_PLACEHOLDER_PINCODE
  );
}

/** True when a field still holds the placeholder value written at signup (not user-entered). */
export function isSignupPlaceholderAddressField(field, value, address = {}, companyName = '') {
  const text = String(value || '').trim();
  if (!text) return false;

  const company = String(companyName || '').trim();
  const corePlaceholders = hasSignupPlaceholderCoreFields(address);

  switch (field) {
    case 'city':
      return /^pending$/i.test(text);
    case 'state':
      return /^pending$/i.test(text);
    case 'pincode':
      return text === SIGNUP_PLACEHOLDER_PINCODE;
    case 'line1':
      if (/^address pending$/i.test(text)) return true;
      return corePlaceholders && company && text.toLowerCase() === company.toLowerCase();
    case 'country':
      return corePlaceholders && text === 'India';
    default:
      return false;
  }
}

/** Strip signup placeholder values so profile UI can show empty fields with placeholders. */
export function sanitizeSignupPlaceholderAddress(address = {}, { companyName = '' } = {}) {
  const normalized = normalizeAddress(address);
  const sanitized = { ...normalized };

  for (const field of ADDRESS_REQUIRED_FIELDS) {
    if (isSignupPlaceholderAddressField(field, sanitized[field], normalized, companyName)) {
      sanitized[field] = '';
    }
  }

  return sanitized;
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

/** Stable key for merging shipments: same supplier + same delivery address → one transport pick. */
export function buildShippingAddressKey(address = {}) {
  const normalized = normalizeAddress(address);
  const parts = [normalized.line1, normalized.city, normalized.state, normalized.pincode, normalized.country]
    .map((part) => String(part || '').trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? parts.join('|') : 'default';
}

export function buildTransportGroupId(vendorId, shippingAddress = {}) {
  const vid = String(vendorId || '').trim();
  const shipKey = buildShippingAddressKey(shippingAddress);
  return `${vid}::${shipKey}`;
}

export function formatShippingAddressLabel(address = {}) {
  const normalized = normalizeAddress(address);
  return [normalized.line1, normalized.city, normalized.state, normalized.pincode, normalized.country]
    .filter(Boolean)
    .join(', ');
}

function resolveShippingFromBoqProject(boqProject) {
  if (!boqProject || typeof boqProject !== 'object') return null;
  const address = normalizeAddress(boqProject.shippingAddress || {});
  if (!isAddressComplete(address)) return null;
  return address;
}

function resolveShippingFromCartDraftForItems(draft, workflowItems = []) {
  if (!draft || typeof draft !== 'object') return null;
  const items = Array.isArray(workflowItems) ? workflowItems : [];
  const lineIds = new Set(
    items.map((it) => String(it?.id ?? '').trim()).filter(Boolean)
  );
  const productIds = new Set(
    items.map((it) => String(it?.productId ?? '').trim()).filter(Boolean)
  );
  const groups = Array.isArray(draft.boqGroups) ? draft.boqGroups : [];
  for (const group of groups) {
    const groupItems = Array.isArray(group?.items) ? group.items : [];
    const overlaps = groupItems.some((it) => {
      const lineId = String(it?.id ?? '').trim();
      const productId = String(it?.productId ?? '').trim();
      return (lineId && lineIds.has(lineId)) || (productId && productIds.has(productId));
    });
    if (!overlaps) continue;
    const fromProject = resolveShippingFromBoqProject(group?.boqProject);
    if (fromProject) return fromProject;
  }

  const root = normalizeAddress(draft.shippingAddress || {});
  if (isAddressComplete(root)) return root;

  for (const group of groups) {
    const fromProject = resolveShippingFromBoqProject(group?.boqProject);
    if (fromProject) return fromProject;
  }

  return null;
}

/** Resolve checkout shipping from workflow project metadata, cart draft, or explicit request. */
export function resolveCheckoutShippingAddress({
  boqProject = null,
  cartDraft = null,
  workflowItems = [],
  requestedAddress = null
} = {}) {
  const requested = normalizeAddress(requestedAddress || {});
  if (isAddressComplete(requested)) return requested;

  const fromProject = resolveShippingFromBoqProject(boqProject);
  if (fromProject) return fromProject;

  const fromCart = resolveShippingFromCartDraftForItems(cartDraft, workflowItems);
  if (fromCart) return fromCart;

  return null;
}

export async function loadServiceProviderPoCartDraft(supabase, userId) {
  const { data: cart } = await supabase
    .from('po_carts')
    .select('draft_payload')
    .eq('service_provider_id', userId)
    .maybeSingle();
  return normalizePoCartDraft(cart?.draft_payload || {});
}

/** Merge PO groups that share supplier + delivery address (safety net after per-item grouping). */
export function consolidatePoTransportGroups(groups) {
  if (!Array.isArray(groups) || groups.length <= 1) return groups || [];

  const merged = new Map();
  for (const group of groups) {
    const vendorId = String(group?.vendorId || '').trim();
    const shippingAddress = group?.shippingAddress || null;
    const mergeKey = group?.transportGroupId || buildTransportGroupId(vendorId, shippingAddress || {});
    if (!merged.has(mergeKey)) {
      merged.set(mergeKey, {
        ...group,
        transportGroupId: mergeKey,
        shippingAddressKey: group?.shippingAddressKey || buildShippingAddressKey(shippingAddress || {}),
        items: [...(group.items || [])]
      });
      continue;
    }
    const existing = merged.get(mergeKey);
    existing.items.push(...(group.items || []));
    existing.total = Math.round((Number(existing.total || 0) + Number(group.total || 0)) * 100) / 100;
    if (!existing.shippingAddress && shippingAddress) {
      existing.shippingAddress = shippingAddress;
      existing.shippingAddressLabel =
        group.shippingAddressLabel || formatShippingAddressLabel(shippingAddress);
    }
  }
  return Array.from(merged.values());
}

export function newPoCartGroupId() {
  try {
    return randomUUID();
  } catch {
    return `g-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function prunePoCartGroupItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((it) => {
    const qty = Number(it?.quantity);
    if (!Number.isFinite(qty)) return true;
    return qty > 0;
  });
}

/** Drop zero-qty lines and remove projects (groups) with no remaining lines. */
export function prunePoCartGroups(boqGroups = []) {
  return (Array.isArray(boqGroups) ? boqGroups : [])
    .map((group) => ({
      ...group,
      items: prunePoCartGroupItems(group?.items)
    }))
    .filter((group) => Array.isArray(group.items) && group.items.length > 0);
}

export function poCartDraftNeedsPersistAfterPrune(rawDraft = {}, normalizedDraft = {}) {
  const rawGroups = Array.isArray(rawDraft?.boqGroups) ? rawDraft.boqGroups : [];
  const nextGroups = Array.isArray(normalizedDraft?.boqGroups) ? normalizedDraft.boqGroups : [];
  if (rawGroups.length !== nextGroups.length) return true;
  const rawLineCount = rawGroups.reduce(
    (sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0),
    0
  );
  const nextLineCount = nextGroups.reduce(
    (sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0),
    0
  );
  if (rawLineCount !== nextLineCount) return true;
  const rawFlatCount = Array.isArray(rawDraft?.items) ? rawDraft.items.length : 0;
  const nextFlatCount = Array.isArray(normalizedDraft?.items) ? normalizedDraft.items.length : 0;
  return rawFlatCount !== nextFlatCount;
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

/**
 * Add an item to a cart project's line list: if a line for the SAME product already exists in
 * this project, increase its quantity instead of appending a duplicate row. A different project
 * (a different `items` array entirely) always keeps its own separate line — this only dedupes
 * within one project's item list.
 */
export function mergeOrAppendCartGroupItem(existingItems, newItem) {
  const items = Array.isArray(existingItems) ? existingItems : [];
  const productId = String(newItem?.productId || '').trim();
  const addQty = Math.max(0, Math.floor(Number(newItem?.quantity) || 0));
  if (!productId) return [...items, newItem];

  const existingIndex = items.findIndex((it) => String(it?.productId || '').trim() === productId);
  if (existingIndex < 0) return [...items, newItem];

  return items.map((it, idx) => {
    if (idx !== existingIndex) return it;
    return {
      ...it,
      quantity: Math.min(MAX_CART_ITEM_QUANTITY, (Number(it.quantity) || 0) + addQty)
    };
  });
}

/**
 * Same idea as `mergeOrAppendCartGroupItem` but for the supplier upstream cart's
 * `selectedMine` map (`{ [supplierProductId]: quantity }`): adding the same product to the
 * same project increases the existing quantity instead of overwriting it.
 */
export function mergeUpstreamSelectedMineQuantity(existingSelectedMine, key, addQty) {
  const existingQuantity = Number(existingSelectedMine?.[key]) || 0;
  const delta = Math.max(0, Math.floor(Number(addQty) || 0));
  return Math.min(MAX_CART_ITEM_QUANTITY, existingQuantity + delta);
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
export function appendDiscoveryItemAsNewProject(boqGroups, item, productName, options = {}) {
  const groups = Array.isArray(boqGroups) ? [...boqGroups] : [];
  const preferredProjectName = String(options?.projectName || '').trim();
  const label = preferredProjectName || String(productName || item?.name || 'Product').trim() || 'Product';
  const expectedDeliveryDate = String(options?.expectedDeliveryDate || '').trim() || null;
  const qty = Math.min(
    MAX_CART_ITEM_QUANTITY,
    Math.max(1, Math.floor(Number(item?.quantity) || 1))
  );
  const resultGroupId = `pd-group-${newPoCartGroupId()}`;
  const newGroup = {
    groupId: resultGroupId,
    createdAt: new Date().toISOString(),
    boqId: null,
    boqName: label,
    boqProject: {
      source: 'product_discovery',
      ...(expectedDeliveryDate ? { requiredDate: expectedDeliveryDate } : {}),
      ...(options.shippingAddressId ? { shippingAddressId: String(options.shippingAddressId) } : {}),
      ...(options.shippingAddress && typeof options.shippingAddress === 'object'
        ? { shippingAddress: options.shippingAddress }
        : {}),
      ...(options.location ? { location: String(options.location) } : {}),
      ...(options.siteGeo && typeof options.siteGeo === 'object' ? { siteGeo: options.siteGeo } : {})
    },
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
      grandTotalAllPos: null,
      transportSelection: null
    };
  }
  const hasGroups = Array.isArray(raw.boqGroups);
  if (hasGroups) {
    const boqGroups = prunePoCartGroups(
      raw.boqGroups.map((g) => ({
        ...g,
        items: Array.isArray(g?.items) ? [...g.items] : []
      }))
    );
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
  let boqGroups = prunePoCartGroups(
    Array.isArray(payload.boqGroups) ? payload.boqGroups.map((g) => ({ ...g })) : []
  );
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
    grandTotalAllPos: payload.grandTotalAllPos ?? null,
    transportSelection:
      payload.transportSelection && typeof payload.transportSelection === 'object'
        ? payload.transportSelection
        : null
  };
}

function normalizeVendorKeyRecord(record) {
  if (!record || typeof record !== 'object') return {};
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [String(key), value]));
}

/** Keep prior supplier transport picks when saving one supplier at a time. */
export function mergeTransportSelection(existing, incoming, vendorIds = null) {
  const existingBy = normalizeVendorKeyRecord(existing?.byVendorId);
  const existingDet = normalizeVendorKeyRecord(existing?.byVendorCourierDetail);
  const incBy = normalizeVendorKeyRecord(incoming?.byVendorId);
  const incDet = normalizeVendorKeyRecord(incoming?.byVendorCourierDetail);

  const explicitIds = Array.isArray(vendorIds)
    ? vendorIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const ids =
    explicitIds.length > 0
      ? explicitIds
      : [...new Set([...Object.keys(existingBy), ...Object.keys(incBy)])];

  const next = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {}),
    byVendorId: { ...existingBy },
    byVendorCourierDetail: { ...existingDet }
  };

  for (const id of ids) {
    if (incBy[id] != null && String(incBy[id]).trim()) {
      next.byVendorId[id] = incBy[id];
    }
    if (incDet[id]) {
      next.byVendorCourierDetail[id] = incDet[id];
    }
  }

  if (incoming?.transportNotes) next.transportNotes = incoming.transportNotes;
  if (incoming?.trackingNumber) next.trackingNumber = incoming.trackingNumber;
  if (incoming?.trackingUrl) next.trackingUrl = incoming.trackingUrl;

  if (Object.keys(next.byVendorId).some((id) => String(next.byVendorId[id] || '').trim())) {
    next.shippingProvider = '';
  }

  return next;
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
