import { supabase } from '../config/supabase.js';
import { randomUUID } from 'crypto';
import { createInvoiceForOrder } from './invoiceService.js';
import { createReceiptAndDeliver } from './paymentReceiptService.js';
import { ensurePaymentTransactionForPaidOrder } from './paymentTransactionService.js';
import { writeAuditLog } from './auditService.js';
import { calculateOrderPlatformFee } from './platformFeeService.js';
import { resolveOrderChargeBreakdown } from '../utils/orderChargeBreakdown.js';

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
    const err = new Error('Insufficient vault balance');
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

async function loadSupplierUserForPayout(supplierId) {
  if (!supplierId) return null;
  const { data, error } = await supabase.from('users').select('*').eq('id', supplierId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadExistingSupplierPayout(orderId) {
  const { data, error } = await supabase
    .from('supplier_payouts')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * After buyer vault payment, release supplier payout via local ledger when applicable.
 * PM vault buyer payments stay held — direct supplier PM vault credit is not wired yet.
 */
export async function releaseSupplierVaultPayoutForOrder({
  order,
  supplierPayoutAmount,
  platformFeeAmount,
  pmPaymentRef = null,
  buyerPmUserId = null,
  actorUserId = null,
  pmCredentials = null,
  idempotencyKey = null,
  usesPmVault = false
}) {
  if (!order?.id || !order?.supplier_id) {
    throw new Error('Order supplier is required to release vault payout');
  }

  const existingPayout = await loadExistingSupplierPayout(order.id);
  if (String(existingPayout?.status || '').toLowerCase() === 'released') {
    return {
      payout: existingPayout,
      alreadyReleased: true,
      supplierCreditRef: existingPayout?.metadata?.supplierCreditRef || null
    };
  }

  const supplierUser = await loadSupplierUserForPayout(order.supplier_id);
  if (!supplierUser) {
    const err = new Error('Supplier account not found for payout release');
    err.code = 'SUPPLIER_NOT_FOUND';
    throw err;
  }

  const netAmount = roundMoney(supplierPayoutAmount);
  const feeAmount = roundMoney(platformFeeAmount);
  let supplierCreditRef = null;
  let payoutChannel = usesPmVault ? 'pm_vault' : 'local_wallet';

  if (usesPmVault) {
    payoutChannel = 'pm_vault';
  } else if (netAmount > 0 || feeAmount > 0) {
    const escrowWallet = await getOrCreateWallet({ userId: null, walletType: PLATFORM_ESCROW_WALLET });
    const supplierWallet = await getOrCreateWallet({
      userId: order.supplier_id,
      walletType: 'supplier'
    });
    const revenueWallet = await getOrCreateWallet({ userId: null, walletType: PLATFORM_REVENUE_WALLET });

    if (netAmount > 0) {
      const transfer = await transferBetweenWallets({
        fromWalletId: escrowWallet.id,
        toWalletId: supplierWallet.id,
        amount: netAmount,
        transactionTypeDebit: 'escrow_release',
        transactionTypeCredit: 'supplier_payout',
        referenceType: 'order',
        referenceId: order.id,
        description: `Supplier payout for order ${order.order_number || order.id}`,
        metadata: {
          orderId: order.id,
          orderNumber: order.order_number || null,
          paymentReference: pmPaymentRef,
          supplierPayoutAmount: netAmount,
          platformFeeAmount: feeAmount
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:supplier` : `supplier-payout:${order.id}`,
        createdBy: actorUserId
      });
      supplierCreditRef = transfer?.transaction?.id || null;
    }

    if (feeAmount > 0) {
      await transferBetweenWallets({
        fromWalletId: escrowWallet.id,
        toWalletId: revenueWallet.id,
        amount: feeAmount,
        transactionTypeDebit: 'escrow_release',
        transactionTypeCredit: 'platform_fee',
        referenceType: 'order',
        referenceId: order.id,
        description: `Platform fee for order ${order.order_number || order.id}`,
        metadata: {
          orderId: order.id,
          orderNumber: order.order_number || null,
          paymentReference: pmPaymentRef,
          platformFeeAmount: feeAmount
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:platform-fee` : `platform-fee:${order.id}`,
        createdBy: actorUserId
      });
    }
    payoutChannel = 'local_wallet';
  }

  const nowIso = new Date().toISOString();
  const payoutReleased = !usesPmVault;
  const { data: payoutRow, error: payoutError } = await supabase
    .from('supplier_payouts')
    .upsert(
      {
        order_id: order.id,
        supplier_id: order.supplier_id,
        gross_amount: roundMoney(order.total_amount),
        platform_fee_amount: feeAmount,
        net_amount: netAmount,
        status: payoutReleased ? 'released' : 'pending',
        released_at: payoutReleased ? nowIso : null,
        metadata: {
          ...(existingPayout?.metadata || {}),
          payoutChannel,
          supplierCreditRef,
          paymentReference: pmPaymentRef || null,
          buyerPmUserId: buyerPmUserId || null,
          ...(usesPmVault ? { supplierPmCreditDeferred: true } : {})
        },
        updated_at: nowIso
      },
      { onConflict: 'order_id' }
    )
    .select('*')
    .single();
  if (payoutError) throw payoutError;

  const orderReleaseUpdate = {
    supplier_payout_amount: netAmount,
    platform_fee_amount: feeAmount,
    ...(payoutReleased ? { wallet_payment_status: 'released' } : {})
  };
  const { data: orderWithRelease, error: orderReleaseError } = await supabase
    .from('orders')
    .update(orderReleaseUpdate)
    .eq('id', order.id)
    .select('*')
    .single();
  if (orderReleaseError) throw orderReleaseError;

  return {
    payout: payoutRow,
    order: orderWithRelease,
    supplierCreditRef,
    payoutChannel,
    alreadyReleased: false
  };
}

export async function mirrorPmTopupToLocalWallet({
  userId,
  amountInRupees,
  razorpayOrderId,
  razorpayPaymentId
}) {
  const amount = roundMoney(amountInRupees);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const customerWallet = await getOrCreateWallet({
    userId,
    walletType: 'customer'
  });

  return creditWallet({
    walletId: customerWallet.id,
    amount,
    transactionType: 'topup',
    referenceType: 'pm_vault_topup',
    referenceId: String(razorpayPaymentId || razorpayOrderId || userId),
      description: 'PM vault top-up mirrored to Tatva vault ledger',
    metadata: {
      source: 'pm_vault',
      razorpayOrderId,
      razorpayPaymentId
    },
    idempotencyKey: `pm-vault-topup-mirror:${razorpayPaymentId || razorpayOrderId}`,
    createdBy: userId
  });
}

export async function syncLocalWalletFromPmBalance({
  userId,
  pmBalance,
  requiredAmount = 0
}) {
  const required = roundMoney(requiredAmount);
  const pmAvailable = roundMoney(pmBalance);
  if (required > 0 && pmAvailable + 0.0001 < required) {
    const err = new Error(
      `Insufficient vault balance. Available INR ${pmAvailable}, required INR ${required}.`
    );
    err.code = 'INSUFFICIENT_WALLET_BALANCE';
    throw err;
  }

  const local = await getWalletBalance({ userId, walletType: 'customer' });
  const targetBalance = required > 0 ? Math.max(required, pmAvailable) : pmAvailable;
  const delta = roundMoney(targetBalance - Number(local.balance || 0));

  if (delta > 0.0001) {
    await creditWallet({
      walletId: local.wallet.id,
      amount: delta,
      transactionType: 'adjustment',
      referenceType: 'pm_vault_sync',
      referenceId: String(userId),
      description: 'PM vault balance sync for Tatva checkout',
      metadata: { source: 'pm_vault', pmBalance: pmAvailable },
      idempotencyKey: `pm-vault-sync:${userId}:${Math.floor(pmAvailable * 100)}`,
      createdBy: userId
    });
  }

  return getWalletBalance({ userId, walletType: 'customer' });
}

export async function payOrderFromWallet({
  orderId,
  actorUserId,
  actorRole = null,
  requestId = null,
  ipAddress = null,
  idempotencyKey = null,
  pmCredentials = null
}) {
  const order = await loadOrderForWalletPay(orderId);
  if (actorRole !== 'admin' && order.service_provider_id !== actorUserId) {
    const err = new Error('Not authorized for this order');
    err.code = 'ORDER_FORBIDDEN';
    throw err;
  }
  if (String(order.payment_status || '').toLowerCase() === 'paid') {
    if (String(order.wallet_payment_status || '').toLowerCase() !== 'released') {
      const orderItems = await loadOrderItemsForFee(order.id);
      const feeResult = await calculateOrderPlatformFee({
        order,
        orderItems,
        supplierId: order.supplier_id
      });
      const grossAmount = roundMoney(order.total_amount);
      const platformFeeAmount = Math.min(
        grossAmount,
        roundMoney(order.platform_fee_amount ?? feeResult.feeAmount)
      );
      const supplierPayoutAmount = roundMoney(
        order.supplier_payout_amount ?? grossAmount - platformFeeAmount
      );
      const pmVault = await import('./pmVaultService.js');
      const { data: actorUser } = await supabase
        .from('users')
        .select('*')
        .eq('id', actorUserId)
        .maybeSingle();
      const usesPmVault = Boolean(actorUser && pmVault.usesPlatformVault(actorUser));

      // PM vault supplier credit is not wired yet — do not claim recovery while funds stay deferred.
      if (usesPmVault) {
        const err = new Error(
          'Buyer payment is already recorded. Supplier PM vault credit is not available for automatic recovery yet.'
        );
        err.code = 'SUPPLIER_PM_CREDIT_DEFERRED';
        err.order = order;
        err.platformFeeAmount = platformFeeAmount;
        err.supplierPayoutAmount = supplierPayoutAmount;
        throw err;
      }

      const payoutRelease = await releaseSupplierVaultPayoutForOrder({
        order,
        supplierPayoutAmount,
        platformFeeAmount,
        pmPaymentRef: order.payment_provider_payment_id || `pm-vault-${order.id}`,
        actorUserId,
        pmCredentials: pmCredentials || {},
        idempotencyKey: idempotencyKey || `wallet-order-pay:${order.id}`,
        usesPmVault: false
      });
      const releasedStatus = String(
        payoutRelease?.order?.wallet_payment_status || ''
      ).toLowerCase();
      if (releasedStatus !== 'released' && !payoutRelease?.alreadyReleased) {
        const err = new Error('Supplier payout recovery did not complete');
        err.code = 'SUPPLIER_PAYOUT_RECOVERY_FAILED';
        err.order = payoutRelease?.order || order;
        throw err;
      }
      return {
        order: payoutRelease.order || order,
        feeBreakdown: feeResult.breakdown,
        platformFeeAmount,
        supplierPayoutAmount,
        supplierPayoutRelease: payoutRelease,
        receiptDelivery: null,
        invoiceSummary: null,
        recoveredPayout: true
      };
    }
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
  const chargeBreakdown = resolveOrderChargeBreakdown(order);
  const grossAmount = roundMoney(chargeBreakdown.combinedTotal);
  if (Math.abs(roundMoney(order.total_amount) - grossAmount) > 0.01) {
    const { data: syncedOrder, error: syncError } = await supabase
      .from('orders')
      .update({ total_amount: grossAmount })
      .eq('id', order.id)
      .select('*')
      .single();
    if (!syncError && syncedOrder) {
      order = syncedOrder;
    } else {
      order.total_amount = grossAmount;
    }
  }
  const platformFeeAmount = Math.min(grossAmount, roundMoney(feeResult.feeAmount));
  const supplierPayoutAmount = roundMoney(grossAmount - platformFeeAmount);

  const { data: actorUser, error: actorUserError } = await supabase
    .from('users')
    .select('*')
    .eq('id', actorUserId)
    .maybeSingle();
  if (actorUserError) throw actorUserError;

  const pmVault = await import('./pmVaultService.js');
  const usesPmVault = Boolean(actorUser && pmVault.usesPlatformVault(actorUser));
  const supplierUser = await loadSupplierUserForPayout(order.supplier_id);
  const supplierPmUserId = supplierUser ? await pmVault.resolvePmUserIdForTatvaUser(supplierUser) : null;

  // SP / supplier vault lives on PM only — never read/write Tatva wallets tables.
  if (usesPmVault) {
    const pmPayment = await pmVault.payOrderFromPmVault({
      user: actorUser,
      orderId: order.id,
      orderNumber: order.order_number || null,
      amountInRupees: grossAmount,
      supplierPmUserId,
      supplierPayoutAmountInRupees: supplierPayoutAmount,
      platformFeeAmountInRupees: platformFeeAmount,
      description: `Order payment for ${order.order_number || order.id}`,
      credentials: pmCredentials || {}
    });

    const pmPaymentRef = pmPayment?.paymentId || `pm-vault-${order.id}`;
    const buyerPmUserId = pmPayment?.buyerPmUserId || null;

    const inferredRole =
      feeResult.breakdown.find((line) => line.supplyChainRole)?.supplyChainRole || null;
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        payment_method: 'vault',
        payment_provider: 'pm_vault',
        payment_provider_payment_id: pmPaymentRef,
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

    const payoutRelease = await releaseSupplierVaultPayoutForOrder({
      order: updatedOrder,
      supplierPayoutAmount,
      platformFeeAmount,
      pmPaymentRef,
      buyerPmUserId,
      actorUserId,
      pmCredentials: pmCredentials || {},
      idempotencyKey: idempotencyKey || `wallet-order-pay:${order.id}`,
      usesPmVault: true
    });
    const orderAfterRelease = payoutRelease.order || updatedOrder;

    await ensurePaymentTransactionForPaidOrder({
      order: orderAfterRelease,
      method: 'vault',
      paymentReference: pmPaymentRef,
      provider: 'pm_vault',
      status: 'captured',
      actorUserId
    });

    const receiptDelivery = await createReceiptAndDeliver({
      order: orderAfterRelease,
      paymentMethod: 'vault',
      paymentReference: pmPaymentRef,
      actorUserId
    });

    let invoiceSummary = null;
    try {
      const { invoice } = await createInvoiceForOrder(orderAfterRelease);
      invoiceSummary = { invoiceNumber: invoice?.invoice_number || null };
    } catch (invoiceErr) {
      console.error('[Vault] Invoice generation failed after PM vault pay:', invoiceErr);
    }

    await writeAuditLog({
      actorUserId,
      actorRole,
      action: 'pm_vault_order_payment_captured',
      resourceType: 'order',
      resourceId: order.id,
      ipAddress,
      requestId,
      metadata: {
        orderId: order.id,
        grossAmount,
        platformFeeAmount,
        supplierPayoutAmount,
        supplierCreditRef: payoutRelease.supplierCreditRef || null,
        payoutChannel: payoutRelease.payoutChannel || 'pm_vault'
      }
    });

    return {
      order: orderAfterRelease,
      feeBreakdown: feeResult.breakdown,
      platformFeeAmount,
      supplierPayoutAmount,
      supplierPayoutRelease: payoutRelease,
      receiptDelivery,
      invoiceSummary
    };
  }

  // Legacy local-ledger path (non-PM buyers only).
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
    description: `Vault payment for order ${order.order_number || order.id}`,
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
      payment_method: 'vault',
      payment_provider: 'vault',
      payment_provider_payment_id: `vault-${order.id}`,
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

  const payoutRelease = await releaseSupplierVaultPayoutForOrder({
    order: updatedOrder,
    supplierPayoutAmount,
    platformFeeAmount,
    pmPaymentRef: `vault-${order.id}`,
    actorUserId,
    idempotencyKey: idempotencyKey || `wallet-order-pay:${order.id}`,
    usesPmVault: false
  });
  const orderAfterRelease = payoutRelease.order || updatedOrder;

  await ensurePaymentTransactionForPaidOrder({
    order: orderAfterRelease,
    method: 'vault',
    paymentReference: `vault-${order.id}`,
    provider: 'vault',
    status: 'captured',
    actorUserId
  });

  const receiptDelivery = await createReceiptAndDeliver({
    order: orderAfterRelease,
    paymentMethod: 'vault',
    paymentReference: `vault-${order.id}`,
    actorUserId
  });

  let invoiceSummary = null;
  try {
    const { invoice } = await createInvoiceForOrder(orderAfterRelease);
    invoiceSummary = {
      invoiceNumber: invoice?.invoice_number || null
    };
  } catch (invoiceErr) {
    console.error('[Vault] Invoice generation failed after local pay:', invoiceErr);
  }

  await writeAuditLog({
    actorUserId,
    actorRole,
    action: 'vault_order_payment_captured',
    resourceType: 'order',
    resourceId: order.id,
    ipAddress,
    requestId,
    metadata: {
      orderId: order.id,
      grossAmount,
      platformFeeAmount,
      supplierPayoutAmount,
      supplierCreditRef: payoutRelease.supplierCreditRef || null,
      payoutChannel: payoutRelease.payoutChannel || 'local_wallet'
    }
  });

  return {
    order: orderAfterRelease,
    feeBreakdown: feeResult.breakdown,
    platformFeeAmount,
    supplierPayoutAmount,
    supplierPayoutRelease: payoutRelease,
    receiptDelivery,
    invoiceSummary
  };
}
