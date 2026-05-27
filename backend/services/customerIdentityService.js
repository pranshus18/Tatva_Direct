import { supabase } from '../config/supabase.js';

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
 * Same person only when BOTH name and phone match (after normalization).
 * Returns null if either is missing — treated as a separate/unidentified customer.
 */
export function buildCustomerIdentityKey(name, phone) {
  const normalizedName = normalizeCustomerName(name);
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedName || !normalizedPhone) return null;
  return `${normalizedName}|${normalizedPhone}`;
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
  const identityKey = buildCustomerIdentityKey(party.name, party.phone);
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
 * Sum order values for the same supplier where customer name AND phone both match.
 */
export async function getCombinedSalesTotalForCustomer({
  supplierId,
  customerName = null,
  customerPhone = null,
  buyerUserId = null,
  customerId = null
}) {
  if (!supplierId) return 0;

  const targetIdentity = buildCustomerIdentityKey(customerName, customerPhone);
  if (!targetIdentity) {
    if (!buyerUserId && !customerId) return 0;
  }

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
  const customerIds = [...new Set(ordersList.map((o) => o.customer_id).filter(Boolean))];

  let usersById = new Map();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, company, phone')
      .in('id', userIds);
    usersById = new Map((users || []).map((u) => [u.id, u]));
  }

  let customersById = new Map();
  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, phone')
      .in('id', customerIds);
    customersById = new Map((customers || []).map((c) => [c.id, c]));
  }

  let total = 0;
  for (const order of ordersList) {
    if (!isCountableSalesOrder(order)) continue;

    if (targetIdentity) {
      const { identityKey } = resolveSalesAggregateKey(order, usersById, customersById);
      if (identityKey === targetIdentity) {
        total += parseFloat(order.total_amount || 0) || 0;
      }
      continue;
    }

    if (buyerUserId && order.service_provider_id === buyerUserId) {
      total += parseFloat(order.total_amount || 0) || 0;
    } else if (customerId && order.customer_id === customerId) {
      total += parseFloat(order.total_amount || 0) || 0;
    }
  }

  return roundMoney(total);
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
