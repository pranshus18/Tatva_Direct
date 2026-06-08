import { supabase } from '../config/supabase.js';
import { isRevenueRecognizedOrder } from '../utils/salesMetrics.js';

export function normalizeCustomerPhone(phone) {
  return String(phone || '')
    .replace(/\s+/g, '')
    .trim();
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function normalizeCustomerName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Same person when phone matches (after normalization), regardless of name.
 * Returns null when phone is missing.
 */
export function buildCustomerIdentityKey(_name, phone) {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return null;
  return normalizedPhone;
}

/** All aggregate keys that may refer to the same buyer/customer for credit lookup. */
export function buildCreditAggregateKeys({
  buyerUserId = null,
  customerId = null,
  phone = null,
  name = null
} = {}) {
  const keys = [];
  if (buyerUserId) keys.push(`user:${buyerUserId}`);
  if (customerId) keys.push(`customer:${customerId}`);
  const normalizedPhone = normalizeCustomerPhone(phone);
  const identityKey = buildCustomerIdentityKey(name, phone);
  if (normalizedPhone) keys.push(`phone:${normalizedPhone}`);
  if (identityKey) keys.push(`identity:${identityKey}`);
  return [...new Set(keys)];
}

export function lookupCreditAccountValue(
  map,
  { buyerId = null, linkedBuyerUserId = null, linkedCustomerId = null, phone = null, name = null } = {}
) {
  const keys = buyerId
    ? [buyerId, ...buildCreditAggregateKeys({ buyerUserId: linkedBuyerUserId, customerId: linkedCustomerId, phone, name })]
    : buildCreditAggregateKeys({ buyerUserId: linkedBuyerUserId, customerId: linkedCustomerId, phone, name });
  const seen = new Set();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (map.has(key)) return map.get(key);
  }
  return 0;
}

export function orderMatchesParty(order, party, usersById = new Map(), customersById = new Map()) {
  const { aggregateKey } = resolveSalesAggregateKey(order, usersById, customersById);
  const partyKeys = buildCreditAggregateKeys({
    buyerUserId: party?.buyerUserId || party?.linkedBuyerUserId,
    customerId: party?.customerId || party?.linkedCustomerId,
    phone: party?.phone,
    name: party?.name
  });
  if (party?.buyerId && aggregateKey === party.buyerId) return true;
  return partyKeys.includes(aggregateKey);
}

export function partyFromBuyerRecord(rec = {}) {
  return {
    buyerId: rec.buyerId || null,
    buyerUserId: rec.linkedBuyerUserId || rec.buyerUserId || null,
    linkedBuyerUserId: rec.linkedBuyerUserId || rec.buyerUserId || null,
    customerId: rec.linkedCustomerId || rec.customerId || null,
    linkedCustomerId: rec.linkedCustomerId || rec.customerId || null,
    phone: rec.phone || null,
    name: rec.name || null
  };
}

/**
 * Gross order value (total_amount) for a buyer across matching online + offline orders.
 * Excludes cancelled/returned. Optional channel: 'online' | 'offline'.
 */
export function sumOrderTotalsForParty(
  orders = [],
  party,
  usersById = new Map(),
  customersById = new Map(),
  { channel = null } = {}
) {
  let total = 0;
  for (const order of orders) {
    if (!isCountableSalesOrder(order)) continue;
    if (!orderMatchesParty(order, party, usersById, customersById)) continue;
    if (channel === 'offline' && !isOfflineSaleChannel(order.channel)) continue;
    if (channel === 'online' && isOfflineSaleChannel(order.channel)) continue;
    total += parseFloat(order.total_amount || 0) || 0;
  }
  return roundMoney(total);
}

/**
 * Paid net revenue (items minus closed returns) for a buyer across matching orders.
 */
export function sumNetRevenueForParty(
  orders = [],
  netRevenueByOrderId = new Map(),
  party,
  usersById = new Map(),
  customersById = new Map(),
  { channel = null } = {}
) {
  let total = 0;
  for (const order of orders) {
    if (!isRevenueRecognizedOrder(order)) continue;
    if (!orderMatchesParty(order, party, usersById, customersById)) continue;
    if (channel === 'offline' && !isOfflineSaleChannel(order.channel)) continue;
    if (channel === 'online' && isOfflineSaleChannel(order.channel)) continue;
    total += netRevenueByOrderId.get(order.id) || 0;
  }
  return roundMoney(total);
}

export function hasCreditPartyFromRecord(rec = {}) {
  return Boolean(
    normalizeCustomerPhone(rec.phone) ||
    rec.linkedBuyerUserId ||
    rec.buyerUserId ||
    rec.linkedCustomerId ||
    rec.customerId
  );
}

export function isOfflineSaleChannel(channel) {
  return String(channel || '').toLowerCase() === 'offline_sale';
}

export function isCountableSalesOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  return status !== 'cancelled' && status !== 'returned';
}

export function resolveOrderParty(order, usersById = new Map(), customersById = new Map()) {
  if (order?.service_provider_id) {
    const user = usersById.get(order.service_provider_id) || {};
    return {
      name: user.name || user.company || null,
      phone: user.phone || null,
      buyerUserId: order.service_provider_id,
      customerId: null
    };
  }
  if (order?.customer_id) {
    const customer = customersById.get(order.customer_id) || {};
    return {
      name: customer.name || null,
      phone: customer.phone || null,
      buyerUserId: null,
      customerId: order.customer_id
    };
  }
  return { name: null, phone: null, buyerUserId: null, customerId: null };
}

export function resolveSalesAggregateKey(order, usersById = new Map(), customersById = new Map()) {
  const party = resolveOrderParty(order, usersById, customersById);
  const identityKey = buildCustomerIdentityKey(null, party.phone);
  if (identityKey) {
    return {
      aggregateKey: `identity:${identityKey}`,
      identityKey,
      buyerType: 'unified',
      party
    };
  }
  if (party.buyerUserId) {
    return {
      aggregateKey: `user:${party.buyerUserId}`,
      identityKey: null,
      buyerType: 'b2b_partial',
      party
    };
  }
  if (party.customerId) {
    return {
      aggregateKey: `customer:${party.customerId}`,
      identityKey: null,
      buyerType: 'pos_partial',
      party
    };
  }
  return {
    aggregateKey: 'walk_in',
    identityKey: null,
    buyerType: 'walk_in',
    party
  };
}

/**
 * Sum order values for the same supplier where customer phone matches.
 */
export async function getCombinedSalesTotalForCustomer({
  supplierId,
  customerName = null,
  customerPhone = null,
  buyerUserId = null,
  customerId = null
}) {
  if (!supplierId) return 0;
  if (!buyerUserId && !customerId && !customerName && !customerPhone) return 0;

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, service_provider_id, customer_id, channel, total_amount, status')
    .eq('supplier_id', supplierId);

  if (error) {
    console.error('[customerIdentity] combined sales query error:', error);
    return 0;
  }

  const ordersList = orders || [];
  const userIds = [...new Set(ordersList.map((o) => o.service_provider_id).filter(Boolean))];
  if (buyerUserId) userIds.push(buyerUserId);
  const customerIds = [...new Set(ordersList.map((o) => o.customer_id).filter(Boolean))];
  if (customerId) customerIds.push(customerId);

  let usersById = new Map();
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, company, phone')
      .in('id', uniqueUserIds);
    usersById = new Map((users || []).map((u) => [u.id, u]));
  }

  let customersById = new Map();
  const uniqueCustomerIds = [...new Set(customerIds.filter(Boolean))];
  if (uniqueCustomerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, phone')
      .in('id', uniqueCustomerIds);
    customersById = new Map((customers || []).map((c) => [c.id, c]));
  }

  let name = customerName;
  let phone = customerPhone;
  if (buyerUserId) {
    const user = usersById.get(buyerUserId) || {};
    name = name || user.name || user.company || null;
    phone = phone || user.phone || null;
  }
  if (customerId) {
    const customer = customersById.get(customerId) || {};
    name = name || customer.name || null;
    phone = phone || customer.phone || null;
  }

  return sumOrderTotalsForParty(
    ordersList,
    { buyerUserId, customerId, linkedBuyerUserId: buyerUserId, linkedCustomerId: customerId, name, phone },
    usersById,
    customersById
  );
}

export async function resolvePartyDetails({
  buyerUserId = null,
  customerId = null,
  customerName = null,
  customerPhone = null,
  creditAccount = null
}) {
  let name = customerName;
  let phone = customerPhone;

  if (buyerUserId) {
    const { data: user } = await supabase
      .from('users')
      .select('name, company, phone')
      .eq('id', buyerUserId)
      .maybeSingle();
    name = name || user?.name || user?.company || null;
    phone = phone || user?.phone || null;
  }

  if (customerId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name, phone')
      .eq('id', customerId)
      .maybeSingle();
    name = name || customer?.name || null;
    phone = phone || customer?.phone || null;
  }

  if (creditAccount) {
    phone = phone || creditAccount.customer_phone || null;
    if (creditAccount.customer_id) {
      const { data: linkedCustomer } = await supabase
        .from('customers')
        .select('name, phone')
        .eq('id', creditAccount.customer_id)
        .maybeSingle();
      name = name || linkedCustomer?.name || null;
      phone = phone || linkedCustomer?.phone || null;
    }
    if (creditAccount.buyer_user_id && creditAccount.buyer_user_id !== buyerUserId) {
      const { data: linkedBuyer } = await supabase
        .from('users')
        .select('name, company, phone')
        .eq('id', creditAccount.buyer_user_id)
        .maybeSingle();
      name = name || linkedBuyer?.name || linkedBuyer?.company || null;
      phone = phone || linkedBuyer?.phone || null;
    }
  }

  return {
    name,
    phone,
    identityKey: buildCustomerIdentityKey(name, phone)
  };
}

/**
 * Resolve name + phone for credit / pay-later (online profile + POS + credit account links).
 */
export async function resolvePartyDetailsForCredit({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerName = null,
  customerPhone = null,
  findCreditAccount = null
}) {
  let account = null;
  if (typeof findCreditAccount === 'function' && supplierId) {
    account = await findCreditAccount({
      supplierId,
      buyerUserId,
      customerId,
      customerPhone
    });
  }

  const party = await resolvePartyDetails({
    buyerUserId: buyerUserId || account?.buyer_user_id || null,
    customerId: customerId || account?.customer_id || null,
    customerName,
    customerPhone: customerPhone || account?.customer_phone || null,
    creditAccount: account
  });

  return { ...party, creditAccount: account };
}
