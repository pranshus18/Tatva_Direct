import { supabase } from '../config/supabase.js';
import { insertNotification } from '../repositories/notificationsRepository.js';
import {
  buildCustomerIdentityKey,
  getCombinedSalesTotalForCustomer,
  isCountableSalesOrder,
  normalizeCustomerName,
  normalizeCustomerPhone,
  resolvePartyDetails,
  resolvePartyDetailsForCredit,
  resolveSalesAggregateKey
} from './customerIdentityService.js';

const CREDIT_WARN_UTILIZATION = Number(process.env.CREDIT_WARN_UTILIZATION || 0.8);
const CREDIT_ALERT_COOLDOWN_MS = Number(process.env.CREDIT_ALERT_COOLDOWN_MS || 24 * 60 * 60 * 1000);

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Pay-later when combined prior sales (online + offline, same name & phone) plus this order meet minimum.
 */
export function isPayLaterThresholdMet(orderAmount, paylaterThreshold, priorSalesTotal = 0) {
  const requested = roundMoney(orderAmount);
  const threshold = roundMoney(paylaterThreshold);
  const prior = roundMoney(priorSalesTotal);
  if (threshold <= 0) return false;
  const combined = prior + requested;
  if (combined <= 0) return false;
  return combined + 0.009 >= threshold;
}

export { buildCustomerIdentityKey, normalizeCustomerName, normalizeCustomerPhone };

async function resolveCustomerIdsForPhone(phone) {
  const normalized = normalizeCustomerPhone(phone);
  if (!normalized) return [];
  const { data } = await supabase.from('customers').select('id').eq('phone', normalized);
  return (data || []).map((r) => r.id).filter(Boolean);
}

/**
 * Outstanding credit = sum of unpaid credit orders for this supplier + buyer/customer.
 */
export async function getOutstandingCredit({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  customerName = null
}) {
  if (!supplierId) return 0;

  const { name, phone } = await resolvePartyDetails({
    buyerUserId,
    customerId,
    customerName,
    customerPhone
  });
  const identityKey = buildCustomerIdentityKey(name, phone);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, service_provider_id, customer_id, total_amount, status, payment_method, payment_status')
    .eq('supplier_id', supplierId)
    .eq('payment_method', 'credit')
    .in('payment_status', ['pending', 'partial']);

  if (error) {
    console.error('[creditAccount] outstanding query error:', error);
    return 0;
  }

  const ordersList = orders || [];
  if (ordersList.length === 0) return 0;

  if (identityKey) {
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
      const { identityKey: orderIdentity } = resolveSalesAggregateKey(order, usersById, customersById);
      if (orderIdentity === identityKey) {
        total += parseFloat(order.total_amount || 0) || 0;
      }
    }
    return roundMoney(total);
  }

  let q = supabase
    .from('orders')
    .select('total_amount')
    .eq('supplier_id', supplierId)
    .eq('payment_method', 'credit')
    .in('payment_status', ['pending', 'partial']);

  if (buyerUserId) {
    q = q.eq('service_provider_id', buyerUserId);
  } else {
    const customerIds = new Set();
    if (customerId) customerIds.add(customerId);
    const phoneIds = await resolveCustomerIdsForPhone(customerPhone);
    phoneIds.forEach((id) => customerIds.add(id));
    if (customerIds.size === 0) return 0;
    q = q.in('customer_id', [...customerIds]);
  }

  const { data, error: legacyError } = await q;
  if (legacyError) {
    console.error('[creditAccount] outstanding query error:', legacyError);
    return 0;
  }
  return roundMoney((data || []).reduce((sum, row) => sum + parseFloat(row.total_amount || 0), 0));
}

export async function findCreditAccount({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null
}) {
  if (!supplierId) return null;

  if (buyerUserId) {
    const { data } = await supabase
      .from('supplier_credit_accounts')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('buyer_user_id', buyerUserId)
      .maybeSingle();
    if (data) return data;
  }

  if (customerId) {
    const { data } = await supabase
      .from('supplier_credit_accounts')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (data) return data;
  }

  const phone = normalizeCustomerPhone(customerPhone);
  if (phone) {
    const { data } = await supabase
      .from('supplier_credit_accounts')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('customer_phone', phone)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

export async function buildCreditStatus({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  customerName = null,
  orderAmount = 0
}) {
  const party = await resolvePartyDetailsForCredit({
    supplierId,
    buyerUserId,
    customerId,
    customerName,
    customerPhone,
    findCreditAccount
  });
  const { name, phone, identityKey } = party;
  let account =
    party.creditAccount ||
    (await findCreditAccount({
      supplierId,
      buyerUserId,
      customerId,
      customerPhone: phone || customerPhone
    }));

  const limit = roundMoney(account?.credit_limit ?? 0);
  const payLaterThreshold = roundMoney(account?.paylater_threshold ?? 0);
  const enabled = account?.is_enabled !== false;
  const periodDays = Number(account?.credit_period_days) || 30;
  const priorSalesTotal = await getCombinedSalesTotalForCustomer({
    supplierId,
    customerName: name,
    customerPhone: phone,
    buyerUserId,
    customerId
  });
  const outstanding = await getOutstandingCredit({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone: phone || customerPhone,
    customerName: name
  });
  const available = roundMoney(Math.max(0, limit - outstanding));
  const requested = roundMoney(orderAmount);
  const combinedSalesTotal = roundMoney(priorSalesTotal + requested);
  const payLaterThresholdMet = isPayLaterThresholdMet(requested, payLaterThreshold, priorSalesTotal);
  const payLaterOffered =
    Boolean(account) &&
    enabled &&
    limit > 0 &&
    payLaterThreshold > 0 &&
    payLaterThresholdMet;

  let allowed = false;
  let message = '';

  if (!account) {
    message = 'No credit account configured for this buyer. Ask your supplier to set a credit limit.';
  } else if (!enabled) {
    message = 'Credit on account is disabled for this buyer.';
  } else if (limit <= 0) {
    message = 'Credit limit is zero. Update the limit before placing on-account orders.';
  } else if (payLaterThreshold <= 0) {
    message =
      'Pay later is not enabled until your supplier sets a minimum order amount on your account.';
  } else if (!identityKey && payLaterThreshold > 0) {
    message =
      'Pay later needs the same customer name and phone on online orders and POS sales. Add phone to the buyer profile or enter both at POS.';
  } else if (!payLaterThresholdMet) {
    message = `Pay later when combined online + offline sales reach ₹${payLaterThreshold.toLocaleString('en-IN')}. Prior sales: ₹${priorSalesTotal.toLocaleString('en-IN')}${requested > 0 ? `, this order: ₹${requested.toLocaleString('en-IN')}, total: ₹${combinedSalesTotal.toLocaleString('en-IN')}` : ''}.`;
  } else if (requested > 0 && outstanding + requested > limit + 0.009) {
    message = `Credit limit exceeded. Available: ₹${available.toLocaleString('en-IN')}, requested: ₹${requested.toLocaleString('en-IN')}.`;
  } else if (payLaterOffered) {
    allowed = true;
    message = `Pay later available. Combined sales ₹${combinedSalesTotal.toLocaleString('en-IN')} meet the ₹${payLaterThreshold.toLocaleString('en-IN')} minimum. Credit available: ₹${available.toLocaleString('en-IN')} of ₹${limit.toLocaleString('en-IN')}.`;
  } else if (requested <= 0 && payLaterThreshold > 0) {
    message = `Pay later when combined online + offline sales (same name & phone) reach ₹${payLaterThreshold.toLocaleString('en-IN')}. Prior sales: ₹${priorSalesTotal.toLocaleString('en-IN')}.`;
  } else {
    message = 'Pay later is not available for this order.';
  }

  return {
    allowed,
    payLaterOffered,
    payLaterThreshold,
    payLaterThresholdMet,
    priorSalesTotal,
    combinedSalesTotal,
    onlineOfflineSalesCombined: priorSalesTotal,
    identityKey: identityKey || null,
    message,
    account: account
      ? {
          id: account.id,
          creditLimit: limit,
          payLaterThreshold,
          creditPeriodDays: periodDays,
          isEnabled: enabled,
          notes: account.notes || null
        }
      : null,
    creditLimit: limit,
    payLaterThreshold,
    payLaterThresholdMet,
    priorSalesTotal,
    combinedSalesTotal,
    onlineOfflineSalesCombined: priorSalesTotal,
    identityKey: identityKey || null,
    creditPeriodDays: periodDays,
    isEnabled: enabled,
    outstanding,
    available,
    requestedAmount: requested
  };
}

export async function validateCreditForOrder(params) {
  return buildCreditStatus(params);
}

export async function listCreditAccountsForSupplier(supplierId) {
  const { data: accounts, error } = await supabase
    .from('supplier_credit_accounts')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const buyerIds = [...new Set((accounts || []).map((a) => a.buyer_user_id).filter(Boolean))];
  const customerIds = [...new Set((accounts || []).map((a) => a.customer_id).filter(Boolean))];

  let buyersById = new Map();
  if (buyerIds.length > 0) {
    const { data: buyers } = await supabase
      .from('users')
      .select('id, name, company, email, phone')
      .in('id', buyerIds);
    buyersById = new Map((buyers || []).map((b) => [b.id, b]));
  }

  let customersById = new Map();
  if (customerIds.length > 0) {
    const { data: customers } = await supabase.from('customers').select('id, name, phone, email').in('id', customerIds);
    customersById = new Map((customers || []).map((c) => [c.id, c]));
  }

  const enriched = [];
  for (const account of accounts || []) {
    const outstanding = await getOutstandingCredit({
      supplierId,
      buyerUserId: account.buyer_user_id,
      customerId: account.customer_id,
      customerPhone: account.customer_phone
    });
    const limit = roundMoney(account.credit_limit);
    const buyer = account.buyer_user_id ? buyersById.get(account.buyer_user_id) : null;
    const customer = account.customer_id ? customersById.get(account.customer_id) : null;

    enriched.push({
      id: account.id,
      buyerUserId: account.buyer_user_id,
      customerId: account.customer_id,
      customerPhone: account.customer_phone,
      creditLimit: limit,
      payLaterThreshold: roundMoney(account.paylater_threshold ?? 0),
      creditPeriodDays: Number(account.credit_period_days) || 30,
      isEnabled: account.is_enabled !== false,
      notes: account.notes || null,
      outstanding,
      available: roundMoney(Math.max(0, limit - outstanding)),
      partyName:
        buyer?.name ||
        buyer?.company ||
        customer?.name ||
        account.customer_phone ||
        'Unknown',
      partyEmail: buyer?.email || customer?.email || null,
      partyPhone: buyer?.phone || customer?.phone || account.customer_phone || null,
      partyType: account.buyer_user_id ? 'b2b_buyer' : 'pos_customer',
      updatedAt: account.updated_at
    });
  }

  return enriched;
}

export async function upsertCreditAccount({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  creditLimit,
  paylaterThreshold = undefined,
  creditPeriodDays = 30,
  isEnabled = true,
  notes = null
}) {
  const limit = roundMoney(creditLimit);
  const period = Math.max(1, Math.floor(Number(creditPeriodDays) || 30));
  const phone = normalizeCustomerPhone(customerPhone) || null;

  const existing = await findCreditAccount({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone: phone
  });

  const threshold =
    paylaterThreshold === undefined
      ? roundMoney(existing?.paylater_threshold ?? 0)
      : roundMoney(paylaterThreshold);

  const row = {
    supplier_id: supplierId,
    buyer_user_id: buyerUserId || null,
    customer_id: customerId || null,
    customer_phone: phone,
    credit_limit: limit,
    paylater_threshold: threshold,
    credit_period_days: period,
    is_enabled: isEnabled !== false,
    notes: notes || null,
    updated_at: new Date().toISOString()
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('supplier_credit_accounts')
      .update(row)
      .eq('id', existing.id)
      .eq('supplier_id', supplierId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from('supplier_credit_accounts').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function hasRecentCreditAlert({ supplierId, creditAccountId, alertKind }) {
  const since = new Date(Date.now() - CREDIT_ALERT_COOLDOWN_MS).toISOString();
  const { data } = await supabase
    .from('notifications')
    .select('id, metadata')
    .eq('user_id', supplierId)
    .eq('type', 'credit_limit')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);

  return (data || []).some(
    (row) =>
      row?.metadata?.creditAccountId === creditAccountId && row?.metadata?.alertKind === alertKind
  );
}

/**
 * Notify supplier when a buyer is at or near their credit limit (deduped per account per alert kind).
 */
export async function maybeNotifySupplierCreditAlert({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  partyName = null
}) {
  if (!supplierId) return;

  const status = await buildCreditStatus({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone,
    orderAmount: 0
  });

  if (!status.account?.id || status.creditLimit <= 0) return;

  const limit = status.creditLimit;
  const outstanding = status.outstanding;
  const utilization = limit > 0 ? outstanding / limit : 0;
  const label = partyName || 'A customer';

  let alertKind = null;
  let title = '';
  let message = '';

  if (utilization >= 0.999) {
    alertKind = 'exhausted';
    title = 'Credit limit fully used';
    message = `${label} has reached the credit limit of ₹${limit.toLocaleString('en-IN')} (outstanding ₹${outstanding.toLocaleString('en-IN')}).`;
  } else if (utilization >= CREDIT_WARN_UTILIZATION) {
    alertKind = 'threshold';
    const pct = Math.round(utilization * 100);
    title = 'Credit limit nearly used';
    message = `${label} has used ${pct}% of their ₹${limit.toLocaleString('en-IN')} credit limit. Available: ₹${status.available.toLocaleString('en-IN')}.`;
  } else {
    return;
  }

  const duplicate = await hasRecentCreditAlert({
    supplierId,
    creditAccountId: status.account.id,
    alertKind
  });
  if (duplicate) return;

  try {
    await insertNotification({
      user_id: supplierId,
      type: 'credit_limit',
      title,
      message,
      is_read: false,
      metadata: {
        creditAccountId: status.account.id,
        alertKind,
        utilization: roundMoney(utilization),
        creditLimit: limit,
        outstanding,
        available: status.available,
        buyerUserId: buyerUserId || null,
        customerPhone: normalizeCustomerPhone(customerPhone) || null
      }
    });
  } catch (e) {
    console.error('[creditAccount] notification error (non-fatal):', e);
  }
}

/** Link POS customer record to phone-keyed credit account after checkout. */
export async function linkCustomerToPhoneCreditAccount({ supplierId, customerId, customerPhone }) {
  const phone = normalizeCustomerPhone(customerPhone);
  if (!supplierId || !customerId || !phone) return;

  const { data: byPhone } = await supabase
    .from('supplier_credit_accounts')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('customer_phone', phone)
    .maybeSingle();

  if (!byPhone) return;

  await supabase
    .from('supplier_credit_accounts')
    .update({ customer_id: customerId, updated_at: new Date().toISOString() })
    .eq('id', byPhone.id)
    .eq('supplier_id', supplierId);
}
