/**
 * Vault UI service — reads/writes PM platform vault APIs directly.
 * Tatva backend (/api/vault/*) is only used for order payment (checkout escrow).
 */
import { getApiUrl, buildAuthHeaders } from '../config/api';
import { restorePmVaultSession } from './pmAuthService';
import {
  addPmVaultOfflineMoney,
  completePmVaultTopup,
  fetchPmVaultView,
  initiatePmVaultTopup
} from './pmVaultService';

const DEFAULT_VAULT_CONFIG = {
  minTopupInr: Number(import.meta.env.VITE_VAULT_MIN_TOPUP_INR || 100) || 100,
  razorpay: { enabled: true, isConfigured: true },
  pmVault: { enabled: true, source: 'pm_platform' }
};

export function resolveVaultBalance(data = {}) {
  const numeric = Number(data.balance ?? data.vault?.balance ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function fetchVaultHeaderBalance() {
  await restorePmVaultSession();
  try {
    const view = await fetchPmVaultView();
    return {
      status: 'success',
      visible: true,
      linked: true,
      source: 'pm_vault',
      balance: view.balance,
      vault: view.vault,
      vaultPath: '/wallet'
    };
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

/** PM GET .../users/api/vault */
export async function fetchVaultBalance() {
  const view = await fetchPmVaultView();
  return {
    status: 'success',
    source: 'pm_vault',
    balance: view.balance,
    holdingAmount: view.holdingAmount,
    vault: view.vault,
    transactions: view.transactions,
    summary: view.summary
  };
}

export async function fetchVaultTransactions() {
  const view = await fetchPmVaultView();
  return {
    status: 'success',
    source: 'pm_vault',
    transactions: view.transactions,
    pageInfo: { hasMore: false, nextCursor: null }
  };
}

export async function fetchVaultLedgerSummary() {
  const view = await fetchPmVaultView();
  return {
    status: 'success',
    source: 'pm_vault',
    summary: view.summary
  };
}

export async function fetchVaultConfig() {
  return {
    status: 'success',
    config: DEFAULT_VAULT_CONFIG
  };
}

/** PM POST .../vault/topup/initiate */
export async function createVaultTopup({ amount }) {
  const paymentIntent = await initiatePmVaultTopup({
    amountInRupees: amount,
    description: 'Vault top-up'
  });
  return {
    status: 'success',
    source: 'pm_vault',
    paymentIntent
  };
}

/** PM POST .../vault/topup/complete */
export async function confirmVaultTopup({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
}) {
  await completePmVaultTopup({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  const view = await fetchPmVaultView();
  return {
    status: 'success',
    source: 'pm_vault',
    vault: view.vault,
    balance: view.balance
  };
}

/** PM POST api.withtatva.ai/users/api/vault/add-money (offline) */
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
  const view = await fetchPmVaultView();
  return {
    status: 'success',
    source: 'pm_vault',
    offline: true,
    result,
    vault: view.vault,
    balance: view.balance
  };
}

/** Tatva backend — order checkout still uses local escrow flow. */
export async function payOrderFromVault(orderId, { idempotencyKey } = {}) {
  await restorePmVaultSession();
  const response = await fetch(getApiUrl(`/api/vault/orders/${orderId}/pay`), {
    method: 'POST',
    headers: buildAuthHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ idempotencyKey })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === 'error') {
    const error = new Error(data.message || 'Failed to pay order from vault');
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function loadVaultSnapshot() {
  const view = await fetchPmVaultView();
  return {
    balance: view.balance,
    holdingAmount: view.holdingAmount,
    vault: view.vault,
    transactions: view.transactions,
    summary: view.summary,
    config: DEFAULT_VAULT_CONFIG,
    source: 'pm_vault'
  };
}

export async function getVaultBalanceForUi() {
  const view = await fetchPmVaultView();
  return view.balance;
}
