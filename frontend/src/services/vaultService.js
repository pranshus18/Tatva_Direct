/**
 * Vault UI service — calls Tatva backend (/api/vault/*), which proxies to PM server-side.
 * Avoids browser CORS against devopsapi.withtatva.ai / api.withtatva.ai.
 */
import { getApiUrl, buildAuthHeaders, authFetch } from '../config/api';
import { PM_PLATFORM_FLAG } from '../config/pmAuth';
import { restorePmVaultSession } from './pmAuthService';
import {
  getLocalVaultPlatformAttributionKeys,
  rememberLocalVaultPlatformAttribution
} from '../utils/vaultPlatformAttribution';

const DEFAULT_VAULT_CONFIG = {
  minTopupInr: Number(import.meta.env.VITE_VAULT_MIN_TOPUP_INR || 1) || 1,
  razorpay: { enabled: true, isConfigured: true },
  pmVault: { enabled: true, source: 'pm_platform' }
};

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function vaultFetch(endpoint, options = {}) {
  await restorePmVaultSession();
  const response = await authFetch(endpoint, {
    ...options,
    headers: buildAuthHeaders({
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {})
    })
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    const error = new Error(data.message || 'Vault request failed');
    error.status = response.status;
    error.code = data.code || (response.status === 401 ? 'PM_AUTH_REQUIRED' : 'VAULT_REQUEST_FAILED');
    throw error;
  }
  return data;
}

export function resolveVaultBalance(data = {}) {
  const numeric = Number(data.balance ?? data.vault?.balance ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function fetchVaultHeaderBalance() {
  try {
    return await vaultFetch('/api/vault/header-balance');
  } catch (error) {
    if (error.code === 'PM_AUTH_REQUIRED' || error.code === 'INVALID_TOKEN' || error.status === 401) {
      return {
        status: 'success',
        visible: true,
        linked: false,
        source: 'pm_vault',
        balance: null,
        vaultPath: '/vault',
        message: error.message || 'PM session expired. Sign in again with phone OTP.'
      };
    }
    throw error;
  }
}

export async function fetchVaultBalance() {
  // Balance only — PM GET /api/vault via Tatva proxy.
  return vaultFetch('/api/vault/balance');
}

/** Reconciliation statement — all platforms via PM GET /api/vault/transactions */
export async function fetchVaultTransactions(params = {}) {
  const query = new URLSearchParams();
  // Do not force flag — reconciliation must show every platform's activity.
  if (params.flag) query.set('flag', String(params.flag));
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.search) query.set('search', params.search);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  const attributionKeys = getLocalVaultPlatformAttributionKeys();
  return vaultFetch(qs ? `/api/vault/transactions?${qs}` : '/api/vault/transactions', {
    headers: attributionKeys.length
      ? { 'x-vault-attribution-keys': JSON.stringify(attributionKeys) }
      : {}
  });
}

export async function fetchVaultLedgerSummary(params = {}) {
  const query = new URLSearchParams();
  if (params.flag) query.set('flag', String(params.flag));
  const qs = query.toString();
  return vaultFetch(qs ? `/api/vault/ledger-summary?${qs}` : '/api/vault/ledger-summary');
}

export async function fetchVaultConfig() {
  try {
    return await vaultFetch('/api/vault/config');
  } catch {
    return {
      status: 'success',
      config: DEFAULT_VAULT_CONFIG
    };
  }
}

/** Proxied: POST /api/vault/topup/create → PM payment initiate (no browser CORS). */
export async function createVaultTopup({ amount, idempotencyKey }) {
  return vaultFetch('/api/vault/topup/create', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      flag: PM_PLATFORM_FLAG,
      ...(idempotencyKey ? { idempotencyKey } : {})
    })
  });
}

/** Proxied: POST /api/vault/topup/confirm → PM payment complete. */
export async function confirmVaultTopup({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
}) {
  const data = await vaultFetch('/api/vault/topup/confirm', {
    method: 'POST',
    body: JSON.stringify({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      flag: PM_PLATFORM_FLAG
    })
  });
  rememberLocalVaultPlatformAttribution(razorpayPaymentId, razorpayOrderId);
  return data;
}

/** Proxied: POST /api/vault/offline/add-money → PM add-money API (multipart, no browser CORS). */
export async function addVaultOfflineMoney({
  amount,
  subPaymentMethod,
  receiptNumber,
  chequeNumber,
  utrNumber,
  details,
  documents
}) {
  await restorePmVaultSession();
  const form = new FormData();
  form.append('amount', String(amount));
  form.append('subPaymentMethod', String(subPaymentMethod || 'cash_on_hand'));
  if (receiptNumber) form.append('receiptNumber', String(receiptNumber));
  if (chequeNumber) form.append('chequeNumber', String(chequeNumber));
  if (utrNumber) form.append('utrNumber', String(utrNumber));
  if (details) form.append('details', String(details));

  const fileList = Array.isArray(documents) ? documents : documents ? [documents] : [];
  fileList.forEach((file) => {
    if (file instanceof File) {
      form.append('documents', file);
    }
  });

  const response = await authFetch('/api/vault/offline/add-money', {
    method: 'POST',
    headers: buildAuthHeaders({ Accept: 'application/json' }),
    body: form
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    const error = new Error(data.message || 'Failed to add offline vault payment');
    error.status = response.status;
    error.code = data.code || (response.status === 401 ? 'PM_AUTH_REQUIRED' : 'PM_VAULT_OFFLINE_FAILED');
    throw error;
  }
  return data;
}

/** Tatva backend — order checkout escrow. */
export async function payOrderFromVault(orderId, { idempotencyKey, skipSessionRestore = false } = {}) {
  if (!skipSessionRestore) {
    await restorePmVaultSession();
  }
  const response = await fetch(getApiUrl(`/api/vault/orders/${orderId}/pay`), {
    method: 'POST',
    headers: buildAuthHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      ...(idempotencyKey ? { idempotencyKey } : {})
    })
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    const detailErrors = Array.isArray(data?.details?.data?.errors)
      ? data.details.data.errors
      : Array.isArray(data?.details?.errors)
        ? data.details.errors
        : [];
    const detailSummary = detailErrors
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item || '');
        const field = item.field || item.param || '';
        const msg = item.message || item.msg || '';
        return field && msg ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join('; ');
    const error = new Error(detailSummary || data.message || 'Failed to pay order from vault');
    error.status = response.status;
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
}

export async function loadVaultSnapshot() {
  const [balanceData, statementData] = await Promise.all([
    // PM GET /api/vault — shared balance
    fetchVaultBalance(),
    // PM GET /api/vault/transactions — all platforms for this user
    fetchVaultTransactions()
  ]);

  const transactions = Array.isArray(statementData?.transactions)
    ? statementData.transactions.map((row) => {
        const details = String(row?.details || row?.description || '');
        const payMatch = details.match(/\b(pay_[A-Za-z0-9_]+)\b/);
        const localKeys = new Set(getLocalVaultPlatformAttributionKeys());
        const attributed =
          localKeys.has(String(row?.id || '')) ||
          localKeys.has(String(row?.reference || '')) ||
          localKeys.has(String(row?.transactionId || '')) ||
          (payMatch?.[1] && localKeys.has(payMatch[1]));
        if (!attributed) return row;
        return { ...row, flag: 'tatvadirect' };
      })
    : [];
  const summary = statementData?.summary || {
    totalCredit: 0,
    totalDebit: 0,
    netFlow: 0,
    transactionCount: transactions.length
  };

  return {
    balance: balanceData.balance,
    holdingAmount: balanceData.holdingAmount,
    vault: balanceData.vault,
    transactions,
    summary,
    statementTitle: statementData?.title || 'Reconciliation statement',
    statementSubtitle: statementData?.subtitle || 'Transactions for your Customer profile',
    config: DEFAULT_VAULT_CONFIG,
    source: 'pm_vault_transactions',
    upstream: statementData?.upstream || null
  };
}

export async function getVaultBalanceForUi() {
  const data = await fetchVaultHeaderBalance();
  return resolveVaultBalance(data);
}
