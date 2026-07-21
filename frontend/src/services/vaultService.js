/**
 * Vault UI service — calls Tatva backend (/api/vault/*), which proxies to PM server-side.
 * Avoids browser CORS against devopsapi.withtatva.ai / api.withtatva.ai.
 */
import { getApiUrl, buildAuthHeaders, authFetch } from '../config/api';
import { restorePmVaultSession } from './pmAuthService';
import { addPmVaultOfflineMoney } from './pmVaultService';

const DEFAULT_VAULT_CONFIG = {
  minTopupInr: Number(import.meta.env.VITE_VAULT_MIN_TOPUP_INR || 100) || 100,
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
    if (error.code === 'PM_AUTH_REQUIRED') {
      return {
        status: 'success',
        visible: true,
        linked: false,
        source: 'pm_vault',
        balance: null,
        vaultPath: '/wallet',
        message: error.message
      };
    }
    throw error;
  }
}

export async function fetchVaultBalance() {
  return vaultFetch('/api/vault/balance');
}

export async function fetchVaultTransactions() {
  return vaultFetch('/api/vault/transactions');
}

export async function fetchVaultLedgerSummary() {
  return vaultFetch('/api/vault/ledger-summary');
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
  return vaultFetch('/api/vault/topup/confirm', {
    method: 'POST',
    body: JSON.stringify({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    })
  });
}

/**
 * Offline add-money still hits PM from the browser (multipart).
 * Prefer Online (Razorpay) on deployed sites until PM whitelists the Vercel origin
 * or we add a backend multipart proxy.
 */
export async function addVaultOfflineMoney({
  amount,
  subPaymentMethod,
  receiptNumber,
  chequeNumber,
  utrNumber,
  details,
  documents
}) {
  const result = await addPmVaultOfflineMoney({
    amountInRupees: amount,
    subPaymentMethod,
    receiptNumber,
    chequeNumber,
    utrNumber,
    details,
    documents
  });
  const balanceData = await fetchVaultBalance().catch(() => ({}));
  return {
    status: 'success',
    source: 'pm_vault',
    offline: true,
    result,
    vault: balanceData.vault,
    balance: balanceData.balance
  };
}

/** Tatva backend — order checkout escrow. */
export async function payOrderFromVault(orderId, { idempotencyKey } = {}) {
  await restorePmVaultSession();
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
    const error = new Error(data.message || 'Failed to pay order from vault');
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function loadVaultSnapshot() {
  const data = await fetchVaultBalance();
  return {
    balance: data.balance,
    holdingAmount: data.holdingAmount,
    vault: data.vault,
    transactions: data.transactions,
    summary: data.summary,
    config: DEFAULT_VAULT_CONFIG,
    source: 'pm_vault'
  };
}

export async function getVaultBalanceForUi() {
  const data = await fetchVaultHeaderBalance();
  return resolveVaultBalance(data);
}
