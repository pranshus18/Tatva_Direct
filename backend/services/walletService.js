import { supabase } from '../config/supabase.js';
import { randomUUID } from 'crypto';
import { createInvoiceForOrder } from './invoiceService.js';
import { createReceiptAndDeliver } from './paymentReceiptService.js';
import { ensurePaymentTransactionForPaidOrder } from './paymentTransactionService.js';
import { writeAuditLog } from './auditService.js';
import { calculateOrderPlatformFee } from './platformFeeService.js';

const PLATFORM_ESCROW_WALLET = 'platform_escrow';
const PLATFORM_REVENUE_WALLET = 'platform_revenue';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(toFiniteNumber(value).toFixed(2));
}

function normalizeWalletType(walletType) {
  const normalized = String(walletType || '').trim().toLowerCase();
  if (['customer', 'supplier', PLATFORM_ESCROW_WALLET, PLATFORM_REVENUE_WALLET].includes(normalized)) return normalized;
  return null;
}

async function lookupWallet({ userId = null, walletType }) {
  let query = supabase.from('wallets').select('*').eq('wallet_type', walletType).eq('is_active', true);
  query = userId ? query.eq('user_id', userId) : query.is('user_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getOrCreateWallet({ userId = null, walletType }) {
  const type = normalizeWalletType(walletType);
  if (!type) throw new Error('Invalid wallet type');
  if ((type === 'customer' || type === 'supplier') && !userId) {
    throw new Error('userId is required for customer/supplier wallets');
  }

  const existing = await lookupWallet({ userId, walletType: type });
  if (existing) return existing;

  const { data, error } = await supabase
    .from('wallets')
    .insert({
      user_id: userId || null,
      wallet_type: type,
      balance: 0,
      currency: 'INR',
      metadata: { createdBy: 'walletService' }
    })
    .select('*')
    .single();
  if (error) {
    // Handle concurrent create.
    const concurrent = await lookupWallet({ userId, walletType: type });
    if (concurrent) return concurrent;
    throw error;
  }
  return data;
}

export async function getWalletBalance({ userId, walletType }) {
  const wallet = await getOrCreateWallet({ userId, walletType });
  return {
    wallet,
    balance: roundMoney(wallet.balance)
  };
}

export async function listWalletTransactions({
  walletId,
  limit = 50,
  cursor = null,
  from = null,
  to = null,
  search = null
}) {
  const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
  let query = supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);
  if (cursor) {
    query = query.lt('created_at', cursor);
  }
  if (from) {
    query = query.gte('created_at', from);
  }
  if (to) {
    query = query.lte('created_at', to);
  }
  const searchNeedle = String(search || '').trim();
  if (searchNeedle) {
    const escaped = searchNeedle.replaceAll(',', '\\,');
    query = query.or(
      `transaction_type.ilike.%${escaped}%,reference_id.ilike.%${escaped}%,reference_type.ilike.%${escaped}%,description.ilike.%${escaped}%`
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const slicedRows = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? slicedRows[slicedRows.length - 1]?.created_at || null : null;
  return {
    rows: slicedRows,
    pageInfo: {
      limit: pageSize,
      nextCursor,
      hasMore
    }
  };
}

export async function summarizeWalletLedger({ walletId, maxRows = 50000 }) {
  if (!walletId) throw new Error('walletId is required');
  const pageSize = 1000;
  const cap = Math.max(pageSize, Number(maxRows) || 50000);
  let offset = 0;
  let totalCredit = 0;
  let totalDebit = 0;
  let transactionCount = 0;

  while (offset < cap) {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('direction,amount')
      .eq('wallet_id', walletId)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    if (!batch.length) break;
    for (const row of batch) {
      const amount = Number(row.amount || 0);
      if (String(row.direction || '').toLowerCase() === 'credit') totalCredit += amount;
      else totalDebit += amount;
    }
    transactionCount += batch.length;
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return {
    totalCredit: roundMoney(totalCredit),
    totalDebit: roundMoney(totalDebit),
    netFlow: roundMoney(totalCredit - totalDebit),
    transactionCount
  };
}

async function ensureIdempotency(idempotencyKey) {
  if (!idempotencyKey) return null;
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateBalanceWithOptimisticLock({ walletId, expectedBalance, nextBalance }) {
  const { data, error } = await supabase
    .from('wallets')
    .update({
      balance: nextBalance,
      updated_at: new Date().toISOString()
    })
    .eq('id', walletId)
    .eq('balance', expectedBalance)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function mutateWallet({
  walletId,
  direction,
  amount,
  transactionType,
  referenceType = null,
  referenceId = null,
  description = '',
  metadata = {},
  idempotencyKey = null,
  createdBy = null
}) {
  const txnAmount = roundMoney(amount);
  if (txnAmount <= 0) throw new Error('Amount must be greater than zero');
  if (!walletId) throw new Error('walletId is required');

  const existing = await ensureIdempotency(idempotencyKey);
  if (existing) {
    return {
      wallet: await getWalletById(walletId),
      transaction: existing,
      idempotentReplay: true
    };
  }

  const walletBefore = await getWalletById(walletId);
  if (!walletBefore) throw new Error('Wallet not found');
  const before = toFiniteNumber(walletBefore.balance);
  const isDebit = direction === 'debit';
  const delta = isDebit ? -txnAmount : txnAmount;
  const after = roundMoney(before + delta);
  if (isDebit && after < 0) {
    const err = new Error('Insufficient wallet balance');
    err.code = 'INSUFFICIENT_WALLET_BALANCE';
    throw err;
  }

  const updatedWallet = await updateBalanceWithOptimisticLock({
    walletId,
    expectedBalance: before,
    nextBalance: after
  });
  if (!updatedWallet) {
    const err = new Error('Wallet balance update conflict, please retry');
    err.code = 'WALLET_BALANCE_CONFLICT';
    throw err;
  }

  const { data: transaction, error: txnError } = await supabase
    .from('wallet_transactions')
    .insert({
      wallet_id: walletId,
      transaction_type: transactionType,
      direction,
      amount: txnAmount,
      balance_before: before,
      balance_after: after,
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: idempotencyKey,
      description,
      metadata: metadata || {},
      created_by: createdBy
    })
    .select('*')
    .single();

  if (txnError) {
    await updateBalanceWithOptimisticLock({
      walletId,
      expectedBalance: after,
      nextBalance: before
    });
    throw txnError;
  }

  return {
    wallet: updatedWallet,
    transaction,
    idempotentReplay: false
  };
}

export async function getWalletById(walletId) {
  const { data, error } = await supabase.from('wallets').select('*').eq('id', walletId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function creditWallet(params) {
  return mutateWallet({ ...params, direction: 'credit' });
}

export async function debitWallet(params) {
  return mutateWallet({ ...params, direction: 'debit' });
}

export async function withdrawFromWallet({
  walletId,
  amount,
  actorUserId,
  idempotencyKey = null,
  note = '',
  referenceId = null,
  referenceType = 'wallet_withdrawal',
  metadata = {}
}) {
  const resolvedReferenceId = referenceId || `withdraw-${randomUUID()}`;
  return debitWallet({
    walletId,
    amount,
    transactionType: 'withdrawal',
    referenceType,
    referenceId: resolvedReferenceId,
    description: note ? `Wallet withdrawal: ${note}` : 'Wallet withdrawal',
    metadata: {
      withdrawalReferenceId: resolvedReferenceId,
      note: note || null,
      ...metadata
    },
    idempotencyKey: idempotencyKey || null,
    createdBy: actorUserId || null
  });
}

export async function listWalletBankAccounts({ userId }) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('wallet_bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function createWalletBankAccount({
  userId,
  accountHolderName = '',
  bankName = '',
  accountNumber = '',
  ifscCode = '',
  upiId = '',
  notes = '',
  isDefault = true
}) {
  if (!userId) throw new Error('userId is required');
  const safeUpiId = String(upiId || '').trim();
  const safeAccountNumber = String(accountNumber || '').trim();
  const safeIfsc = String(ifscCode || '').trim().toUpperCase();
  if (!safeUpiId && (!safeAccountNumber || !safeIfsc)) {
    throw new Error('Provide either UPI ID or account number with IFSC');
  }
  if (isDefault) {
    await supabase.from('wallet_bank_accounts').update({ is_default: false }).eq('user_id', userId);
  }
  const { data, error } = await supabase
    .from('wallet_bank_accounts')
    .insert({
      user_id: userId,
      account_holder_name: String(accountHolderName || '').trim() || null,
      bank_name: String(bankName || '').trim() || null,
      account_number: safeAccountNumber || null,
      ifsc_code: safeIfsc || null,
      upi_id: safeUpiId || null,
      notes: String(notes || '').trim() || null,
      is_default: Boolean(isDefault),
      is_active: true
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getWalletBankAccountById({ bankAccountId, userId = null }) {
  if (!bankAccountId) return null;
  let query = supabase.from('wallet_bank_accounts').select('*').eq('id', bankAccountId).eq('is_active', true);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getDefaultWalletBankAccount({ userId }) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('wallet_bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_default', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function createWalletWithdrawalRequest({
  walletId,
  userId,
  amount,
  note = '',
  idempotencyKey = null,
  bankAccountId = null
}) {
  const wallet = await getWalletById(walletId);
  if (!wallet) throw new Error('Wallet not found');
  const requestAmount = roundMoney(amount);
  if (requestAmount <= 0) throw new Error('Amount must be greater than zero');
  const availableBalance = roundMoney(wallet.balance);
  if (requestAmount > availableBalance) {
    const err = new Error('Withdrawal amount exceeds available wallet balance');
    err.code = 'INSUFFICIENT_WALLET_BALANCE';
    throw err;
  }

  let bankAccount = null;
  if (bankAccountId) {
    bankAccount = await getWalletBankAccountById({ bankAccountId, userId });
  }
  if (!bankAccount) {
    bankAccount = await getDefaultWalletBankAccount({ userId });
  }
  if (!bankAccount) {
    const err = new Error('Please add withdrawal bank details before requesting withdrawal');
    err.code = 'BANK_DETAILS_REQUIRED';
    throw err;
  }

  if (idempotencyKey) {
    const { data: existing, error: existingError } = await supabase
      .from('wallet_withdrawal_requests')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;
  }

  const metadata = {
    bankAccountSnapshot: {
      id: bankAccount.id,
      accountHolderName: bankAccount.account_holder_name || null,
      bankName: bankAccount.bank_name || null,
      accountNumberMasked: bankAccount.account_number
        ? `****${String(bankAccount.account_number).slice(-4)}`
        : null,
      ifscCode: bankAccount.ifsc_code || null,
      upiId: bankAccount.upi_id || null
    }
  };
  const { data, error } = await supabase
    .from('wallet_withdrawal_requests')
    .insert({
      wallet_id: walletId,
      user_id: userId,
      amount: requestAmount,
      status: 'pending',
      note: note || null,
      idempotency_key: idempotencyKey || null,
      bank_account_id: bankAccount.id,
      requested_balance_snapshot: availableBalance,
      metadata
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listWalletWithdrawalRequests({
  status = null,
  limit = 50,
  cursor = null,
  userId = null,
  walletId = null
}) {
  const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
  let query = supabase
    .from('wallet_withdrawal_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);
  if (status) query = query.eq('status', status);
  if (cursor) query = query.lt('created_at', cursor);
  if (userId) query = query.eq('user_id', userId);
  if (walletId) query = query.eq('wallet_id', walletId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const slicedRows = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? slicedRows[slicedRows.length - 1]?.created_at || null : null;
  return {
    rows: slicedRows,
    pageInfo: { limit: pageSize, hasMore, nextCursor }
  };
}

export async function approveWalletWithdrawalRequest({
  withdrawalId,
  actorUserId,
  payoutReference = null,
  note = ''
}) {
  const { data: request, error: requestError } = await supabase
    .from('wallet_withdrawal_requests')
    .select('*')
    .eq('id', withdrawalId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) {
    const err = new Error('Withdrawal request not found');
    err.code = 'WITHDRAWAL_NOT_FOUND';
    throw err;
  }
  if (request.status !== 'pending') {
    const err = new Error('Withdrawal request is already processed');
    err.code = 'WITHDRAWAL_ALREADY_PROCESSED';
    throw err;
  }
  const nowIso = new Date().toISOString();
  const debitResult = await withdrawFromWallet({
    walletId: request.wallet_id,
    amount: request.amount,
    actorUserId,
    idempotencyKey: `wallet-withdraw-approve:${request.id}`,
    note: note || request.note || '',
    referenceId: request.id,
    referenceType: 'wallet_withdrawal_request',
    metadata: {
      approvedBy: actorUserId || null,
      payoutReference: payoutReference || null
    }
  });
  const { data: updated, error: updateError } = await supabase
    .from('wallet_withdrawal_requests')
    .update({
      status: 'approved',
      approved_by: actorUserId || null,
      approved_at: nowIso,
      processed_at: nowIso,
      payout_reference: payoutReference || null,
      note: note || request.note || null,
      transaction_id: debitResult?.transaction?.id || null,
      updated_at: nowIso
    })
    .eq('id', request.id)
    .select('*')
    .single();
  if (updateError) throw updateError;
  return updated;
}

export async function rejectWalletWithdrawalRequest({ withdrawalId, actorUserId, note = '' }) {
  const { data: request, error: requestError } = await supabase
    .from('wallet_withdrawal_requests')
    .select('*')
    .eq('id', withdrawalId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) {
    const err = new Error('Withdrawal request not found');
    err.code = 'WITHDRAWAL_NOT_FOUND';
    throw err;
  }
  if (request.status !== 'pending') {
    const err = new Error('Withdrawal request is already processed');
    err.code = 'WITHDRAWAL_ALREADY_PROCESSED';
    throw err;
  }
  const { data, error } = await supabase
    .from('wallet_withdrawal_requests')
    .update({
      status: 'rejected',
      approved_by: actorUserId || null,
      approved_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      note: note || request.note || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', request.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function transferBetweenWallets({
  fromWalletId,
  toWalletId,
  amount,
  transactionTypeDebit,
  transactionTypeCredit,
  referenceType = null,
  referenceId = null,
  description = '',
  metadata = {},
  idempotencyKey = null,
  createdBy = null
}) {
  if (!fromWalletId || !toWalletId) throw new Error('fromWalletId and toWalletId are required');
  if (fromWalletId === toWalletId) throw new Error('Cannot transfer to same wallet');

  const debit = await debitWallet({
    walletId: fromWalletId,
    amount,
    transactionType: transactionTypeDebit,
    referenceType,
    referenceId,
    description,
    metadata,
    idempotencyKey: idempotencyKey ? `${idempotencyKey}:debit` : null,
    createdBy
  });
  try {
    const credit = await creditWallet({
      walletId: toWalletId,
      amount,
      transactionType: transactionTypeCredit,
      referenceType,
      referenceId,
      description,
      metadata,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:credit` : null,
      createdBy
    });
    return { debit, credit };
  } catch (e) {
    // Best-effort compensation if second leg fails.
    await creditWallet({
      walletId: fromWalletId,
      amount,
      transactionType: 'adjustment',
      referenceType: 'transfer_rollback',
      referenceId: referenceId || null,
      description: 'Automatic rollback for failed wallet transfer credit leg',
      metadata: { originalError: e?.message || 'unknown', ...metadata },
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:rollback` : null,
      createdBy
    });
    throw e;
  }
}

export async function createWalletTopupRecord({
  walletId,
  userId,
  amount,
  idempotencyKey,
  razorpayOrderId,
  metadata = {}
}) {
  const { data, error } = await supabase
    .from('wallet_topups')
    .insert({
      wallet_id: walletId,
      user_id: userId,
      amount: roundMoney(amount),
      status: 'pending',
      idempotency_key: idempotencyKey || null,
      razorpay_order_id: razorpayOrderId || null,
      metadata: metadata || {}
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function completeWalletTopup({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  actorUserId = null,
  expectedUserId = null
}) {
  const { data: topup, error: topupError } = await supabase
    .from('wallet_topups')
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();
  if (topupError) throw topupError;
  if (!topup) {
    const err = new Error('Wallet top-up order not found');
    err.code = 'WALLET_TOPUP_NOT_FOUND';
    throw err;
  }
  if (expectedUserId && topup.user_id !== expectedUserId) {
    const err = new Error('Not authorized for this wallet top-up');
    err.code = 'WALLET_TOPUP_FORBIDDEN';
    throw err;
  }
  if (topup.status === 'completed') return topup;

  await creditWallet({
    walletId: topup.wallet_id,
    amount: topup.amount,
    transactionType: 'topup',
    referenceType: 'wallet_topup',
    referenceId: topup.id,
    description: 'Wallet top-up via Razorpay',
    metadata: {
      provider: 'razorpay',
      razorpayOrderId,
      razorpayPaymentId
    },
    idempotencyKey: `wallet-topup-credit:${topup.id}:${razorpayPaymentId}`,
    createdBy: actorUserId || topup.user_id
  });

  const { data: updated, error: updateError } = await supabase
    .from('wallet_topups')
    .update({
      status: 'completed',
      razorpay_payment_id: razorpayPaymentId,
      provider_signature: razorpaySignature || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', topup.id)
    .select('*')
    .single();
  if (updateError) throw updateError;
  return updated;
}

async function loadOrderForWalletPay(orderId) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) {
    const err = new Error('Order not found');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  return order;
}

async function loadOrderItemsForFee(orderId) {
  const { data: rows, error } = await supabase
    .from('order_items')
    .select(`
      id,
      quantity,
      unit_price,
      total_price,
      product:products (
        id,
        brand
      )
    `)
    .eq('order_id', orderId);
  if (error) throw error;
  return rows || [];
}

async function resolveOrderBuyerWalletType(order) {
  const channel = String(order?.channel || '').toLowerCase();
  if (channel === 'b2b_po') return 'supplier';
  const buyerId = order?.service_provider_id;
  if (!buyerId) return 'customer';
  const { data: buyer, error } = await supabase
    .from('users')
    .select('user_type')
    .eq('id', buyerId)
    .maybeSingle();
  if (error) throw error;
  return String(buyer?.user_type || '').toLowerCase() === 'supplier' ? 'supplier' : 'customer';
}

export async function payOrderFromWallet({
  orderId,
  actorUserId,
  actorRole = null,
  requestId = null,
  ipAddress = null,
  idempotencyKey = null
}) {
  const order = await loadOrderForWalletPay(orderId);
  if (actorRole !== 'admin' && order.service_provider_id !== actorUserId) {
    const err = new Error('Not authorized for this order');
    err.code = 'ORDER_FORBIDDEN';
    throw err;
  }
  if (String(order.payment_status || '').toLowerCase() === 'paid') {
    const err = new Error('Order is already paid');
    err.code = 'ORDER_ALREADY_PAID';
    throw err;
  }

  const orderItems = await loadOrderItemsForFee(order.id);
  const feeResult = await calculateOrderPlatformFee({
    order,
    orderItems,
    supplierId: order.supplier_id
  });
  const grossAmount = roundMoney(order.total_amount);
  const platformFeeAmount = Math.min(grossAmount, roundMoney(feeResult.feeAmount));
  const supplierPayoutAmount = roundMoney(grossAmount - platformFeeAmount);

  const buyerWalletType = await resolveOrderBuyerWalletType(order);
  const customerWallet = await getOrCreateWallet({
    userId: order.service_provider_id,
    walletType: buyerWalletType
  });
  const escrowWallet = await getOrCreateWallet({ userId: null, walletType: PLATFORM_ESCROW_WALLET });

  await transferBetweenWallets({
    fromWalletId: customerWallet.id,
    toWalletId: escrowWallet.id,
    amount: grossAmount,
    transactionTypeDebit: 'order_payment',
    transactionTypeCredit: 'order_hold',
    referenceType: 'order',
    referenceId: order.id,
    description: `Wallet payment for order ${order.order_number || order.id}`,
    metadata: {
      orderId: order.id,
      orderNumber: order.order_number,
      platformFeeAmount,
      supplierPayoutAmount
    },
    idempotencyKey: idempotencyKey || `wallet-order-pay:${order.id}`,
    createdBy: actorUserId
  });

  const inferredRole = feeResult.breakdown.find((line) => line.supplyChainRole)?.supplyChainRole || null;
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      payment_method: 'wallet',
      payment_provider: 'wallet',
      payment_provider_payment_id: `wallet-${order.id}`,
      payment_verified_at: new Date().toISOString(),
      wallet_payment_status: 'held',
      platform_fee_amount: platformFeeAmount,
      supplier_payout_amount: supplierPayoutAmount,
      supply_chain_role_at_payment: inferredRole,
      platform_fee_breakdown: feeResult.breakdown
    })
    .eq('id', order.id)
    .select('*')
    .single();
  if (updateError) throw updateError;

  const { error: payoutError } = await supabase.from('supplier_payouts').upsert(
    {
      order_id: order.id,
      supplier_id: order.supplier_id,
      gross_amount: grossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: supplierPayoutAmount,
      status: 'pending',
      metadata: {
        feeBreakdown: feeResult.breakdown
      },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'order_id' }
  );
  if (payoutError) throw payoutError;

  await ensurePaymentTransactionForPaidOrder({
    order: updatedOrder,
    method: 'wallet',
    paymentReference: `wallet-${order.id}`,
    provider: 'wallet',
    status: 'captured',
    actorUserId
  });

  const receiptDelivery = await createReceiptAndDeliver({
    order: updatedOrder,
    paymentMethod: 'wallet',
    paymentReference: `wallet-${order.id}`,
    actorUserId
  });

  let invoiceSummary = null;
  try {
    const { invoice } = await createInvoiceForOrder(updatedOrder);
    invoiceSummary = {
      invoiceNumber: invoice?.invoice_number || null
    };
  } catch (invoiceErr) {
    console.error('[Wallet] Invoice generation failed after wallet pay:', invoiceErr);
  }

  await writeAuditLog({
    actorUserId,
    actorRole,
    action: 'wallet_order_payment_captured',
    resourceType: 'order',
    resourceId: order.id,
    ipAddress,
    requestId,
    metadata: {
      orderId: order.id,
      grossAmount,
      platformFeeAmount,
      supplierPayoutAmount
    }
  });

  return {
    order: updatedOrder,
    feeBreakdown: feeResult.breakdown,
    platformFeeAmount,
    supplierPayoutAmount,
    receiptDelivery,
    invoiceSummary
  };
}
