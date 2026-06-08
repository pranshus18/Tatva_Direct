import { supabase } from '../config/supabase.js';
import { insertNotification } from '../repositories/notificationsRepository.js';
import { buildOrderNetRevenueMap, fetchClosedReturnQuantityByOrderItem } from '../utils/netRevenue.js';
import { recordLedgerEntry } from './ledgerService.js';
import {
  buildCustomerIdentityKey,
  isCountableSalesOrder,
  normalizeCustomerName,
  normalizeCustomerPhone,
  orderMatchesParty,
  resolvePartyDetails,
  resolvePartyDetailsForCredit
} from './customerIdentityService.js';
import {
  computePayLaterOffered,
  computePayLaterCycleLimitGate,
  isPayLaterThresholdMet,
  isPaidRecognizedOrder,
  isRevenueRecognizedOrder,
  roundMoney
} from '../utils/salesMetrics.js';

export { isPaidRecognizedOrder, isRevenueRecognizedOrder };

const CREDIT_WARN_UTILIZATION = Number(process.env.CREDIT_WARN_UTILIZATION || 0.8);
const CREDIT_ALERT_COOLDOWN_MS = Number(process.env.CREDIT_ALERT_COOLDOWN_MS || 24 * 60 * 60 * 1000);

export { isPayLaterThresholdMet };

/** Sum paid net revenue (after returns) for all orders belonging to this buyer/customer. */
export async function getCombinedNetRevenueForCustomer({
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
    .select('id, service_provider_id, customer_id, total_amount, status, payment_status')
    .eq('supplier_id', supplierId);

  if (error) {
    console.error('[creditAccount] net revenue query error:', error);
    return 0;
  }

  const ordersList = orders || [];
  const recognizedOrders = ordersList.filter(isPaidRecognizedOrder);
  const recognizedOrderIds = recognizedOrders.map((order) => order.id).filter(Boolean);
  if (recognizedOrderIds.length === 0) return 0;

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

  const party = {
    buyerUserId,
    customerId,
    linkedBuyerUserId: buyerUserId,
    linkedCustomerId: customerId,
    name,
    phone
  };

  const { data: orderItems, error: itemsError } = await supabase
    .from('order_items')
    .select('id, order_id, quantity, unit_price, total_price')
    .in('order_id', recognizedOrderIds);

  if (itemsError) {
    console.error('[creditAccount] net revenue items query error:', itemsError);
    return 0;
  }

  const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
    supabase,
    recognizedOrderIds
  );
  const orderNetRevenueById = buildOrderNetRevenueMap(orderItems || [], closedReturnedQtyByOrderItem);

  let total = 0;
  for (const order of recognizedOrders) {
    if (!orderMatchesParty(order, party, usersById, customersById)) continue;
    total += orderNetRevenueById.get(order.id) || 0;
  }

  return roundMoney(total);
}

export { buildCustomerIdentityKey, normalizeCustomerName, normalizeCustomerPhone };

async function resolveCustomerIdsForPhone(phone) {
  const normalized = normalizeCustomerPhone(phone);
  if (!normalized) return [];
  const { data } = await supabase.from('customers').select('id').eq('phone', normalized);
  return (data || []).map((r) => r.id).filter(Boolean);
}

/**
 * Unpaid credit orders for a supplier + buyer/customer (loan-cycle outstanding).
 */
export async function getUnpaidCreditOrdersForParty({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  customerName = null
}) {
  if (!supplierId) return [];

  const { name, phone } = await resolvePartyDetails({
    buyerUserId,
    customerId,
    customerName,
    customerPhone
  });

  const { data: orders, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, service_provider_id, customer_id, total_amount, status, payment_method, payment_status, created_at'
    )
    .eq('supplier_id', supplierId)
    .eq('payment_method', 'credit')
    .in('payment_status', ['pending', 'partial']);

  if (error) {
    console.error('[creditAccount] unpaid credit query error:', error);
    return [];
  }

  const ordersList = orders || [];
  if (ordersList.length === 0) return [];

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

  const party = {
    buyerUserId,
    customerId,
    linkedBuyerUserId: buyerUserId,
    linkedCustomerId: customerId,
    name,
    phone
  };

  return ordersList.filter(
    (order) => isCountableSalesOrder(order) && orderMatchesParty(order, party, usersById, customersById)
  );
}

/**
 * Loan cycle: starts at first unpaid credit order; due = start + credit_period_days.
 * Revenue/metrics recognize only after full cycle settlement (all orders marked paid).
 */
export function computeCreditCycleFromOrders(unpaidOrders = [], periodDays = 30) {
  const period = Math.max(1, Math.floor(Number(periodDays) || 30));
  const countable = (unpaidOrders || []).filter((order) => isCountableSalesOrder(order));
  const outstanding = roundMoney(
    countable.reduce((sum, order) => sum + (parseFloat(order.total_amount || 0) || 0), 0)
  );

  if (countable.length === 0) {
    return {
      outstanding: 0,
      cycleStartedAt: null,
      cycleDueAt: null,
      isOverdue: false,
      daysRemaining: period,
      unpaidOrderCount: 0,
      unpaidOrderIds: []
    };
  }

  const sorted = [...countable].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const cycleStartedAt = sorted[0].created_at;
  const dueMs = new Date(cycleStartedAt).getTime() + period * 86400000;
  const cycleDueAt = new Date(dueMs).toISOString();
  const now = Date.now();
  const isOverdue = outstanding > 0 && now > dueMs;
  const daysRemaining = Math.max(0, Math.ceil((dueMs - now) / 86400000));

  return {
    outstanding,
    cycleStartedAt,
    cycleDueAt,
    isOverdue,
    daysRemaining,
    unpaidOrderCount: countable.length,
    unpaidOrderIds: countable.map((order) => order.id).filter(Boolean)
  };
}

/**
 * Outstanding credit = sum of unpaid credit orders for this supplier + buyer/customer.
 */
export async function getOutstandingCredit(params) {
  const unpaid = await getUnpaidCreditOrdersForParty(params);
  return computeCreditCycleFromOrders(unpaid).outstanding;
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
  const priorNetRevenue = await getCombinedNetRevenueForCustomer({
    supplierId,
    customerName: name,
    customerPhone: phone,
    buyerUserId,
    customerId
  });
  const unpaidOrders = await getUnpaidCreditOrdersForParty({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone: phone || customerPhone,
    customerName: name
  });
  const cycle = computeCreditCycleFromOrders(unpaidOrders, periodDays);
  const outstanding = cycle.outstanding;
  const requested = roundMoney(orderAmount);
  const projectedNetRevenue = roundMoney(priorNetRevenue + requested);
  const hasCreditParty = Boolean(
    normalizeCustomerPhone(phone || customerPhone) ||
      buyerUserId ||
      customerId ||
      account?.buyer_user_id ||
      account?.customer_id
  );
  let { payLaterOffered, payLaterThresholdMet, thresholdOptional } = computePayLaterOffered({
    hasAccount: Boolean(account),
    isEnabled: enabled,
    creditLimit: limit,
    paylaterThreshold: payLaterThreshold,
    priorNetRevenue,
    hasCreditParty,
    buyerType: null
  });
  const { cycleBlocksPayLater, exceedsCreditLimit, remainingCredit } = computePayLaterCycleLimitGate({
    cycleIsOverdue: cycle.isOverdue,
    outstanding,
    creditLimit: limit,
    orderAmount: requested
  });
  const available = remainingCredit;

  let allowed = false;
  let message = '';

  const formatDue = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-IN');
    } catch {
      return '';
    }
  };

  if (!account) {
    message = 'No credit account configured for this buyer. Ask your supplier to set a credit limit.';
    payLaterOffered = false;
  } else if (!enabled) {
    message = 'Credit on account is disabled for this buyer.';
    payLaterOffered = false;
  } else if (limit <= 0) {
    message = 'Credit limit is zero. Update the limit before placing on-account orders.';
    payLaterOffered = false;
  } else if (!thresholdOptional && !payLaterThresholdMet) {
    message = `Pay later unlocks when net revenue reaches ₹${payLaterThreshold.toLocaleString('en-IN')}. Current net revenue: ₹${priorNetRevenue.toLocaleString('en-IN')}.`;
    payLaterOffered = false;
  } else if (!thresholdOptional && !hasCreditParty) {
    message =
      'Pay later mapping requires a linked buyer/customer identity. Link this account to a buyer or customer (or add phone) and try again.';
    payLaterOffered = false;
  } else if (cycleBlocksPayLater) {
    payLaterOffered = false;
    message = `Loan cycle ended${cycle.cycleDueAt ? ` on ${formatDue(cycle.cycleDueAt)}` : ''}. Pay the full outstanding ₹${outstanding.toLocaleString('en-IN')} before using pay later. You can still pay by cash, UPI, card, or online.`;
  } else if (exceedsCreditLimit) {
    payLaterOffered = false;
    message = `Credit limit is ₹${limit.toLocaleString('en-IN')}. Outstanding ₹${outstanding.toLocaleString('en-IN')} — you can use up to ₹${available.toLocaleString('en-IN')} more on pay later, but this order is ₹${requested.toLocaleString('en-IN')}. Choose another payment method to complete this order.`;
  } else if (payLaterOffered) {
    allowed = true;
    const cycleHint =
      cycle.unpaidOrderCount > 0
        ? ` Loan cycle due ${formatDue(cycle.cycleDueAt)} (${cycle.daysRemaining} day${cycle.daysRemaining === 1 ? '' : 's'} left).`
        : ` New loan cycle: ${periodDays} days.`;
    if (thresholdOptional) {
      message = `Credit limit ₹${limit.toLocaleString('en-IN')}: ₹${outstanding.toLocaleString('en-IN')} outstanding, ₹${available.toLocaleString('en-IN')} remaining for this order.${cycleHint}`;
    } else {
      message = `Pay later available. Credit limit ₹${limit.toLocaleString('en-IN')}: ₹${outstanding.toLocaleString('en-IN')} outstanding, ₹${available.toLocaleString('en-IN')} remaining for this order.${cycleHint}`;
    }
  } else if (requested <= 0 && !thresholdOptional && payLaterThreshold > 0) {
    message = `Pay later when net revenue reaches ₹${payLaterThreshold.toLocaleString('en-IN')}. Current net revenue: ₹${priorNetRevenue.toLocaleString('en-IN')}.`;
  } else {
    message = 'Pay later is not available for this order.';
    payLaterOffered = false;
  }

  allowed = payLaterOffered;

  return {
    allowed,
    payLaterOffered,
    payLaterThreshold,
    payLaterThresholdMet,
    thresholdOptional,
    priorNetRevenue,
    priorSalesTotal: priorNetRevenue,
    projectedNetRevenue,
    combinedNetRevenue: projectedNetRevenue,
    combinedSalesTotal: projectedNetRevenue,
    onlineOfflineSalesCombined: priorNetRevenue,
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
    creditPeriodDays: periodDays,
    isEnabled: enabled,
    outstanding,
    available,
    remainingCredit: available,
    maxOrderAmount: available,
    requestedAmount: requested,
    cycleStartedAt: cycle.cycleStartedAt,
    cycleDueAt: cycle.cycleDueAt,
    cycleIsOverdue: cycle.isOverdue,
    cycleDaysRemaining: cycle.daysRemaining,
    unpaidOrderCount: cycle.unpaidOrderCount,
    requiresFullSettlement: outstanding > 0
  };
}

export async function validateCreditForOrder(params) {
  return buildCreditStatus(params);
}

/**
 * Settle the full loan cycle: mark all unpaid credit orders paid so revenue/metrics recognize.
 */
export async function settleCreditCycle({
  supplierId,
  buyerUserId = null,
  customerId = null,
  customerPhone = null,
  customerName = null
}) {
  if (!supplierId) {
    throw new Error('supplierId is required');
  }

  const unpaidOrders = await getUnpaidCreditOrdersForParty({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone,
    customerName
  });

  if (unpaidOrders.length === 0) {
    const credit = await buildCreditStatus({
      supplierId,
      buyerUserId,
      customerId,
      customerPhone,
      customerName,
      orderAmount: 0
    });
    return {
      settled: false,
      settledAmount: 0,
      settledOrderCount: 0,
      message: 'No outstanding credit to settle.',
      credit
    };
  }

  const orderIds = unpaidOrders.map((order) => order.id).filter(Boolean);
  const settledAmount = roundMoney(
    unpaidOrders.reduce((sum, order) => sum + (parseFloat(order.total_amount || 0) || 0), 0)
  );

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      updated_at: new Date().toISOString()
    })
    .in('id', orderIds)
    .eq('supplier_id', supplierId);

  if (updateError) {
    throw updateError;
  }

  for (const order of unpaidOrders) {
    const amount = parseFloat(order.total_amount || 0) || 0;
    if (amount <= 0) continue;
    try {
      await recordLedgerEntry({
        debitAccount: 'Cash/Bank',
        creditAccount: 'Accounts Receivable',
        amount,
        referenceType: 'credit_cycle_settlement',
        referenceId: order.id,
        description: `Loan cycle settlement for order ${order.order_number || order.id}`,
        metadata: {
          supplierId,
          buyerUserId: buyerUserId || null,
          customerId: customerId || null,
          customerPhone: normalizeCustomerPhone(customerPhone) || null
        }
      });
    } catch (ledgerErr) {
      console.error('[creditAccount] settlement ledger error (non-fatal):', ledgerErr);
    }
  }

  const credit = await buildCreditStatus({
    supplierId,
    buyerUserId,
    customerId,
    customerPhone,
    customerName,
    orderAmount: 0
  });

  return {
    settled: true,
    settledAmount,
    settledOrderCount: orderIds.length,
    message: `Settled ₹${settledAmount.toLocaleString('en-IN')} across ${orderIds.length} credit order${orderIds.length === 1 ? '' : 's'}. Revenue and dashboard totals are updated.`,
    credit
  };
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
    const periodDays = Number(account.credit_period_days) || 30;
    const unpaidOrders = await getUnpaidCreditOrdersForParty({
      supplierId,
      buyerUserId: account.buyer_user_id,
      customerId: account.customer_id,
      customerPhone: account.customer_phone
    });
    const cycle = computeCreditCycleFromOrders(unpaidOrders, periodDays);
    const outstanding = cycle.outstanding;
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
      creditPeriodDays: periodDays,
      isEnabled: account.is_enabled !== false,
      notes: account.notes || null,
      outstanding,
      available: roundMoney(Math.max(0, limit - outstanding)),
      cycleStartedAt: cycle.cycleStartedAt,
      cycleDueAt: cycle.cycleDueAt,
      cycleIsOverdue: cycle.isOverdue,
      cycleDaysRemaining: cycle.daysRemaining,
      unpaidOrderCount: cycle.unpaidOrderCount,
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
