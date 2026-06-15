import { supabase } from '../config/supabase.js';

const PLATFORM_PARTY = {
  platform_escrow: { id: 'platform_escrow', label: 'Platform Escrow', type: 'platform' },
  platform_revenue: { id: 'platform_revenue', label: 'Platform Revenue', type: 'platform' }
};

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function toUserLabel(user) {
  if (!user) return 'Unknown User';
  const name = String(user.name || '').trim();
  const company = String(user.company || '').trim();
  if (name && company) return `${name} (${company})`;
  return name || company || user.id || 'Unknown User';
}

function userParty(user) {
  if (!user) return { id: null, label: 'Unknown User', type: 'user' };
  return {
    id: user.id,
    label: toUserLabel(user),
    type: String(user.user_type || '').toLowerCase() || 'user'
  };
}

function walletOwnerParty(wallet, usersById) {
  if (wallet?.user_id) {
    return userParty(usersById.get(wallet.user_id));
  }
  return PLATFORM_PARTY[wallet?.wallet_type] || { id: null, label: 'Platform', type: 'platform' };
}

function resolveOrderId(txn) {
  if (txn.reference_type === 'order' && txn.reference_id) return txn.reference_id;
  return txn.metadata?.orderId || null;
}

function resolveTopupId(txn) {
  if (txn.reference_type === 'wallet_topup' && txn.reference_id) return txn.reference_id;
  return null;
}

async function loadOrdersByIds(orderIds) {
  if (!orderIds.length) return new Map();
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id,order_number,service_provider_id,supplier_id,total_amount,platform_fee_amount,supplier_payout_amount,payment_status'
    )
    .in('id', orderIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

async function loadTopupsByIds(topupIds) {
  if (!topupIds.length) return new Map();
  const { data, error } = await supabase
    .from('wallet_topups')
    .select('id,user_id,status,amount,razorpay_order_id,razorpay_payment_id')
    .in('id', topupIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

async function loadUsersByIds(userIds) {
  if (!userIds.length) return new Map();
  const { data, error } = await supabase
    .from('users')
    .select('id,name,company,user_type')
    .in('id', userIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

function inferParties({ txn, wallet, order, topup, usersById }) {
  const selfParty = walletOwnerParty(wallet, usersById);
  const supplierParty = order?.supplier_id ? userParty(usersById.get(order.supplier_id)) : null;
  const serviceProviderParty = order?.service_provider_id
    ? userParty(usersById.get(order.service_provider_id))
    : null;
  const escrowParty = PLATFORM_PARTY.platform_escrow;
  const revenueParty = PLATFORM_PARTY.platform_revenue;

  if (txn.transaction_type === 'topup') {
    return {
      paidBy: { id: 'external_gateway', label: 'External Payment Gateway', type: 'external' },
      paidTo: selfParty
    };
  }

  switch (txn.transaction_type) {
    case 'order_payment':
      return { paidBy: serviceProviderParty || selfParty, paidTo: escrowParty };
    case 'order_hold':
      return { paidBy: serviceProviderParty || { id: null, label: 'Service Provider', type: 'service_provider' }, paidTo: escrowParty };
    case 'escrow_release':
    case 'supplier_payout':
      return { paidBy: escrowParty, paidTo: supplierParty || selfParty };
    case 'platform_fee':
      return { paidBy: escrowParty, paidTo: revenueParty };
    case 'withdrawal':
      return {
        paidBy: selfParty,
        paidTo: { id: 'external_bank', label: 'External Bank Account', type: 'external' }
      };
    default: {
      if (topup?.user_id) {
        const topupUser = userParty(usersById.get(topup.user_id));
        return { paidBy: { id: 'external_gateway', label: 'External Payment Gateway', type: 'external' }, paidTo: topupUser };
      }
      return txn.direction === 'debit'
        ? { paidBy: selfParty, paidTo: { id: null, label: 'System', type: 'system' } }
        : { paidBy: { id: null, label: 'System', type: 'system' }, paidTo: selfParty };
    }
  }
}

export async function enrichWalletTransactions({ wallet, transactions }) {
  const txs = Array.isArray(transactions) ? transactions : [];
  if (!txs.length) return [];

  const orderIds = unique(txs.map(resolveOrderId));
  const topupIds = unique(txs.map(resolveTopupId));
  const ordersById = await loadOrdersByIds(orderIds);
  const topupsById = await loadTopupsByIds(topupIds);

  const userIds = unique([
    wallet?.user_id || null,
    ...[...ordersById.values()].flatMap((order) => [order.service_provider_id, order.supplier_id]),
    ...[...topupsById.values()].map((row) => row.user_id)
  ]);
  const usersById = await loadUsersByIds(userIds);

  return txs.map((txn) => {
    const orderId = resolveOrderId(txn);
    const topupId = resolveTopupId(txn);
    const order = orderId ? ordersById.get(orderId) || null : null;
    const topup = topupId ? topupsById.get(topupId) || null : null;
    const parties = inferParties({ txn, wallet, order, topup, usersById });
    const grossAmount = Number(order?.total_amount || txn.amount || 0);
    const feeAmount = Number(order?.platform_fee_amount || txn.metadata?.platformFeeAmount || 0);
    const supplierPayoutAmount = Number(
      order?.supplier_payout_amount || txn.metadata?.supplierPayoutAmount || Math.max(0, grossAmount - feeAmount)
    );

    return {
      ...txn,
      orderId: order?.id || orderId || null,
      orderNumber: order?.order_number || null,
      paymentStatus: order?.payment_status || null,
      paidBy: parties.paidBy,
      paidTo: parties.paidTo,
      serviceProvider: order?.service_provider_id
        ? userParty(usersById.get(order.service_provider_id))
        : null,
      supplier: order?.supplier_id ? userParty(usersById.get(order.supplier_id)) : null,
      grossAmount,
      platformFeeAmount: feeAmount,
      supplierPayoutAmount,
      topup: topup
        ? {
            id: topup.id,
            status: topup.status,
            amount: Number(topup.amount || 0),
            razorpayOrderId: topup.razorpay_order_id || null,
            razorpayPaymentId: topup.razorpay_payment_id || null
          }
        : null
    };
  });
}
