import {
  PM_PAYMENT_API_BASE_URL,
  PM_VAULT_ADD_MONEY_URL,
  PM_VAULT_PAY_ORDER_URL,
  PM_VAULT_TOPUP_COMPLETE_URL,
  PM_VAULT_TOPUP_INITIATE_URL,
  PM_VAULT_URL
} from '../config/pmApi.js';
import {
  fetchPmCurrentUser,
  fetchPmUserByPhone,
  getPmAuthFromUser,
  persistPmAuthCredentials
} from './pmUserService.js';
import logger from '../utils/logger.js';

const PM_VAULT_TOPUP_COMPLETE_FALLBACK_URL = `${PM_PAYMENT_API_BASE_URL}/api/v1/payments/vault/topup/complete`;

const PM_VAULT_BALANCE_IN_PAISE =
  String(process.env.PM_VAULT_BALANCE_IN_PAISE || 'true').trim().toLowerCase() === 'true';

/** PM top-up initiate historically expects paise; Tatva APIs always use INR rupees. */
const PM_VAULT_TOPUP_AMOUNT_IN_PAISE =
  String(process.env.PM_VAULT_TOPUP_AMOUNT_IN_PAISE || 'true').trim().toLowerCase() === 'true';

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function unwrapPmPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function resolveVaultRecord(vaultPayload) {
  const unwrapped = unwrapPmPayload(vaultPayload) || {};
  if (Array.isArray(unwrapped)) {
    return unwrapped[0] && typeof unwrapped[0] === 'object' ? unwrapped[0] : {};
  }
  if (unwrapped.vault && typeof unwrapped.vault === 'object') {
    return unwrapped.vault;
  }
  if (unwrapped.wallet && typeof unwrapped.wallet === 'object') {
    return unwrapped.wallet;
  }
  return unwrapped;
}

function collectPmFieldErrors(payload) {
  const buckets = [
    payload?.errors,
    payload?.data?.errors,
    payload?.details?.errors,
    payload?.data?.details?.errors
  ];
  const out = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (item == null) continue;
      out.push(item);
    }
  }
  return out;
}

function formatPmFieldError(item) {
  if (item == null) return '';
  if (typeof item !== 'object') return String(item);
  const path = Array.isArray(item.path)
    ? item.path.join('.')
    : item.param || item.field || item.path || '';
  const msg = item.message || item.msg || '';
  if (path && msg) return `${path}: ${msg}`;
  return msg || JSON.stringify(item);
}

function pmRequestFailed(response, payload, fallbackMessage) {
  const fieldErrors = collectPmFieldErrors(payload);
  const fieldSummary = fieldErrors.map(formatPmFieldError).filter(Boolean).join('; ');

  const topMessage =
    payload?.message ||
    (typeof payload?.error === 'string' ? payload.error : null) ||
    fieldErrors[0]?.message ||
    fieldErrors[0]?.msg ||
    null;

  const detailParts = [];
  if (topMessage) detailParts.push(String(topMessage));
  // Avoid duplicating the same generic "Validation failed" when field details exist.
  if (fieldSummary) {
    const topIsGeneric =
      !topMessage || /^validation failed$/i.test(String(topMessage).trim());
    if (topIsGeneric) {
      detailParts.length = 0;
      detailParts.push(fieldSummary);
    } else if (!detailParts.includes(fieldSummary)) {
      detailParts.push(fieldSummary);
    }
  }

  if (payload?.details && typeof payload.details === 'string' && !detailParts.includes(payload.details)) {
    detailParts.push(payload.details);
  }

  const message =
    detailParts.filter(Boolean).join(' — ') ||
    fallbackMessage ||
    `PM request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  const pmCode = payload?.code || payload?.error || null;
  error.code =
    pmCode === 'VALIDATION_ERROR' || /validation failed/i.test(String(topMessage || ''))
      ? 'PM_VAULT_VALIDATION_FAILED'
      : pmCode || 'PM_VAULT_REQUEST_FAILED';
  error.payload = payload;
  error.fieldErrors = fieldErrors;
  return error;
}

function normalizePmObjectId(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid).trim();
    if (value._id != null && value._id !== value) return normalizePmObjectId(value._id);
    if (value.id != null && value.id !== value) return normalizePmObjectId(value.id);
    if (typeof value.toHexString === 'function') {
      try {
        return String(value.toHexString()).trim();
      } catch {
        /* ignore */
      }
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const asString = String(value.toString()).trim();
      if (asString && asString !== '[object Object]') return asString;
    }
  }
  const fallback = String(value || '').trim();
  return fallback === '[object Object]' ? '' : fallback;
}

function validationNeedsAmount(error) {
  const fieldErrors = Array.isArray(error?.fieldErrors)
    ? error.fieldErrors
    : collectPmFieldErrors(error?.payload);
  const blob = `${error?.message || ''} ${JSON.stringify(fieldErrors || [])}`.toLowerCase();
  if (blob.includes('amount') || blob.includes('body.amount')) return true;
  // Generic Validation failed with no field breakdown — amount is the most common missing field.
  if (!fieldErrors.length && /validation failed/i.test(String(error?.message || ''))) return true;
  return false;
}

function validationRejectsUnknownKeys(error) {
  const blob = `${error?.message || ''} ${JSON.stringify(error?.fieldErrors || error?.payload || {})}`.toLowerCase();
  return (
    blob.includes('unrecognized') ||
    blob.includes('unexpected') ||
    blob.includes('not allowed') ||
    blob.includes('invalid enum') ||
    blob.includes('strict')
  );
}

function toInr(value, { assumePaise = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (assumePaise) return numeric / 100;
  return numeric;
}

function toPaise(amountInRupees) {
  const numeric = Number(amountInRupees);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  return Math.round(numeric * 100);
}

/** Alias used by tests / callers that need INR → paise for PM payment APIs. */
export function convertInrToPaise(amountInRupees) {
  return toPaise(amountInRupees);
}

function normalizeIndianMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function readPmCredentialsFromRequest(req) {
  const headers = req?.headers || {};
  const body = req?.body || {};
  return {
    pmAccessToken:
      headers['x-pm-access-token'] ||
      headers['X-PM-Access-Token'] ||
      body.pmAccessToken ||
      null,
    pmRefreshToken:
      headers['x-pm-refresh-token'] ||
      headers['X-PM-Refresh-Token'] ||
      body.pmRefreshToken ||
      null
  };
}

export function usesPlatformVault(user) {
  const userType = String(user?.user_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const phone = normalizeIndianMobile(user?.phone);
  if (phone.length !== 10) return false;
  return userType === 'service_provider' || userType === 'supplier';
}

export async function ensurePmVaultAuth(user, credentials = {}) {
  const stored = getPmAuthFromUser(user) || {};
  const accessToken = String(
    credentials.pmAccessToken || credentials.accessToken || stored.accessToken || ''
  ).trim();
  const refreshToken = String(
    credentials.pmRefreshToken || credentials.refreshToken || stored.refreshToken || ''
  ).trim();

  if (!accessToken) {
    const error = new Error(
      'Sign in with phone OTP to access your shared vault balance on Tatva Direct.'
    );
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const pmUserFromToken = await fetchPmCurrentUser(accessToken);
  const phone = normalizeIndianMobile(user?.phone || pmUserFromToken?.phoneNumber);
  const pmUserFromPhone =
    !pmUserFromToken && phone ? await fetchPmUserByPhone(phone) : null;
  const pmUser = pmUserFromToken || pmUserFromPhone;

  const pmUserId = normalizePmObjectId(
    pmUser?._id ||
      pmUser?.id ||
      user?.profile?.pmCustomerProfile?.pmUserId ||
      stored.pmUserId ||
      ''
  );

  if (!pmUserId) {
    const error = new Error(
      'Could not resolve your PM account. Sign in again with phone OTP to use the vault.'
    );
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  if (user?.id) {
    await persistPmAuthCredentials(user, {
      pmUserId,
      accessToken,
      refreshToken: refreshToken || undefined
    });
  }

  return { pmUserId, accessToken, refreshToken: refreshToken || null };
}

/** @deprecated use usesPlatformVault + ensurePmVaultAuth */
export function isPmVaultEnabledForUser(user) {
  return usesPlatformVault(user);
}

/** @deprecated use ensurePmVaultAuth */
export function resolvePmVaultAuth(user) {
  const stored = getPmAuthFromUser(user);
  const pmUserId = String(
    stored?.pmUserId || user?.profile?.pmCustomerProfile?.pmUserId || ''
  ).trim();
  const accessToken = String(stored?.accessToken || '').trim();
  if (!pmUserId || !accessToken) {
    const error = new Error(
      'Sign in with phone OTP to access your shared vault balance on Tatva Direct.'
    );
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }
  return { pmUserId, accessToken };
}

function resolveVaultHoldingInr(vault) {
  if (!vault || typeof vault !== 'object') return 0;

  const paiseCandidate =
    vault.holdingAmountInPaise ??
    vault.holdingBalanceInPaise ??
    vault.lockedBalanceInPaise ??
    vault.blockedBalanceInPaise ??
    null;
  if (paiseCandidate !== null && paiseCandidate !== undefined) {
    return toInr(paiseCandidate, { assumePaise: true });
  }

  const holdingCandidate =
    vault.holdingAmount ??
    vault.holdingBalance ??
    vault.lockedBalance ??
    vault.blockedBalance ??
    vault.escrowBalance ??
    vault.onHoldBalance ??
    null;
  if (holdingCandidate !== null && holdingCandidate !== undefined) {
    return toInr(holdingCandidate, { assumePaise: PM_VAULT_BALANCE_IN_PAISE });
  }

  const total = toInr(
    vault.totalBalance ?? vault.balance ?? vault.walletBalance ?? 0,
    { assumePaise: PM_VAULT_BALANCE_IN_PAISE }
  );
  const available = resolveVaultBalanceInr(vault);
  if (total > available + 0.0001) {
    return total - available;
  }
  return 0;
}

function resolveVaultBalanceInr(vault) {
  if (!vault || typeof vault !== 'object') return 0;

  const paiseCandidate =
    vault.balanceInPaise ??
    vault.availableBalanceInPaise ??
    vault.walletBalanceInPaise ??
    vault.totalBalanceInPaise ??
    null;
  if (paiseCandidate !== null && paiseCandidate !== undefined) {
    return toInr(paiseCandidate, { assumePaise: true });
  }

  const balanceCandidate =
    vault.balance ??
    vault.availableBalance ??
    vault.walletBalance ??
    vault.currentBalance ??
    vault.totalBalance ??
    vault.availableAmount ??
    vault.amount ??
    0;

  return toInr(balanceCandidate, { assumePaise: PM_VAULT_BALANCE_IN_PAISE });
}

function normalizePmTransactionDirection(entry) {
  const raw =
    entry?.direction ||
    entry?.type ||
    entry?.transactionType ||
    entry?.txnType ||
    entry?.entryType ||
    '';
  const normalized = String(raw).trim().toLowerCase();
  if (normalized.includes('credit') || normalized === 'cr' || normalized === 'in') return 'credit';
  if (normalized.includes('debit') || normalized === 'dr' || normalized === 'out') return 'debit';
  const signedAmount = Number(entry?.amount ?? entry?.value ?? 0);
  if (signedAmount < 0) return 'debit';
  return 'credit';
}

function normalizePmTransactionAmount(entry) {
  const raw = entry?.amount ?? entry?.value ?? entry?.amountInPaise ?? entry?.amount_in_paise ?? 0;
  const numeric = Math.abs(Number(raw || 0));
  if (!Number.isFinite(numeric)) return 0;

  const explicitPaise =
    entry?.amountInPaise !== undefined || entry?.amount_in_paise !== undefined;
  const assumePaise = explicitPaise || PM_VAULT_BALANCE_IN_PAISE;
  return toInr(numeric, { assumePaise });
}

export function mapPmVaultTransactions(vault) {
  const rows = Array.isArray(vault?.transactions)
    ? vault.transactions
    : Array.isArray(vault?.ledger)
      ? vault.ledger
      : Array.isArray(vault?.history)
        ? vault.history
        : [];

  return rows.map((entry, index) => {
    const direction = normalizePmTransactionDirection(entry);
    const amount = normalizePmTransactionAmount(entry);
    const createdAt =
      entry?.createdAt ||
      entry?.created_at ||
      entry?.timestamp ||
      entry?.date ||
      new Date().toISOString();

    return {
      id: String(entry?._id || entry?.id || entry?.transactionId || `pm-txn-${index}`),
      created_at: createdAt,
      description: String(entry?.description || entry?.note || entry?.purpose || 'Vault transaction'),
      transaction_type: String(entry?.transactionType || entry?.type || entry?.category || 'wallet'),
      direction,
      amount,
      balance_after: toInr(
        entry?.balanceAfter ??
          entry?.balance_after ??
          entry?.closingBalance ??
          entry?.balance ??
          0,
        {
          assumePaise:
            entry?.balanceAfterInPaise !== undefined ||
            entry?.balance_after_in_paise !== undefined ||
            PM_VAULT_BALANCE_IN_PAISE
        }
      ),
      balance_before: toInr(entry?.balanceBefore ?? entry?.balance_before ?? 0, {
        assumePaise:
          entry?.balanceBeforeInPaise !== undefined || PM_VAULT_BALANCE_IN_PAISE
      }),
      orderId: entry?.orderId || entry?.order_id || null,
      orderNumber: entry?.orderNumber || entry?.order_number || null,
      source: 'pm_vault'
    };
  });
}

export function summarizePmVaultLedger(transactions = []) {
  const totals = transactions.reduce(
    (acc, row) => {
      const amount = Number(row.amount || 0);
      if (row.direction === 'credit') acc.totalCredit += amount;
      else acc.totalDebit += amount;
      acc.transactionCount += 1;
      return acc;
    },
    { totalCredit: 0, totalDebit: 0, transactionCount: 0 }
  );

  return {
    ...totals,
    netFlow: totals.totalCredit - totals.totalDebit
  };
}

export function mapPmVaultToWalletView(vaultPayload) {
  const vault = resolveVaultRecord(vaultPayload) || {};
  const balance = resolveVaultBalanceInr(vault);
  const holdingAmount = resolveVaultHoldingInr(vault);
  const transactions = mapPmVaultTransactions(vault);

  return {
    vault: {
      id: String(vault?._id || vault?.id || vault?.vaultId || 'pm-vault'),
      balance,
      holdingAmount,
      currency: String(vault?.currency || 'INR'),
      source: 'pm_vault',
      status: String(vault?.status || 'active')
    },
    wallet: {
      id: String(vault?._id || vault?.id || vault?.vaultId || 'pm-vault'),
      balance,
      holdingAmount,
      currency: String(vault?.currency || 'INR'),
      source: 'pm_vault',
      status: String(vault?.status || 'active')
    },
    balance,
    holdingAmount,
    transactions,
    summary: summarizePmVaultLedger(transactions),
    raw: vault
  };
}

export async function fetchPmVault({ accessToken }) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('PM session expired. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const response = await fetch(PM_VAULT_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok || payload.success === false) {
    throw pmRequestFailed(response, payload, 'Failed to load vault balance');
  }

  return payload;
}

export async function initiatePmVaultTopup({ pmUserId, amountInRupees, description, accessToken }) {
  const token = String(accessToken || '').trim();
  const userId = String(pmUserId || '').trim();
  if (!userId || !token) {
    const error = new Error('PM vault session is missing. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const amountRupees = Number(amountInRupees);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new Error('Amount must be greater than zero');
  }
  // Round to 2 dp (paise precision) while keeping rupees as the app unit.
  const amountInr = Math.round(amountRupees * 100) / 100;
  const amountPaise = Math.round(amountInr * 100);
  const pmAmount = PM_VAULT_TOPUP_AMOUNT_IN_PAISE ? amountPaise : amountInr;

  const response = await fetch(PM_VAULT_TOPUP_INITIATE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      userId,
      amount: pmAmount,
      description: String(description || 'Vault top-up').trim() || 'Vault top-up'
    })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok || payload.success === false) {
    throw pmRequestFailed(response, payload, 'Failed to initiate vault top-up');
  }

  const data = unwrapPmPayload(payload) || {};
  const razorpay = data.razorpay || data.checkout || data.paymentIntent || data.payment || {};
  const orderId =
    data.razorpay_order_id ||
    data.razorpayOrderId ||
    razorpay.order_id ||
    razorpay.orderId ||
    razorpay.id ||
    data.orderId ||
    data.order_id ||
    null;
  const keyId =
    data.razorpay_key_id ||
    data.razorpayKeyId ||
    razorpay.key_id ||
    razorpay.keyId ||
    razorpay.key ||
    data.keyId ||
    data.key_id ||
    null;

  // Razorpay checkout always needs paise; prefer PM-returned amount when it is already paise.
  const upstreamAmount = Number(
    data.amount ?? data.orderAmount ?? data.order_amount ?? razorpay.amount ?? NaN
  );
  let checkoutPaise = amountPaise;
  if (Number.isFinite(upstreamAmount) && upstreamAmount > 0) {
    // If PM echoes rupees, convert; if it echoes paise (~100x), keep as paise.
    checkoutPaise =
      Math.abs(upstreamAmount - amountInr) < 0.011
        ? amountPaise
        : Math.abs(upstreamAmount - amountPaise) < 1
          ? Math.round(upstreamAmount)
          : upstreamAmount >= amountInr * 50
            ? Math.round(upstreamAmount)
            : Math.round(upstreamAmount * 100);
  }

  if (!orderId || !keyId) {
    const error = new Error('Vault top-up did not return Razorpay checkout details.');
    error.code = 'PM_TOPUP_INIT_INCOMPLETE';
    throw error;
  }

  return {
    provider: 'razorpay',
    orderId,
    /** App-facing unit: Indian rupees */
    amount: amountInr,
    amountInRupees: amountInr,
    /** Razorpay checkout unit only */
    amountPaise: checkoutPaise,
    currency: String(data.currency || 'INR'),
    keyId
  };
}

async function postPmVaultTopupComplete(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await parseJsonResponse(response);
  return { response, payload };
}

export async function completePmVaultTopup({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  accessToken
}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('PM session expired. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const body = {
    razorpay_order_id: String(razorpayOrderId || '').trim(),
    razorpay_payment_id: String(razorpayPaymentId || '').trim(),
    razorpay_signature: String(razorpaySignature || '').trim()
  };

  let result;
  try {
    result = await postPmVaultTopupComplete(PM_VAULT_TOPUP_COMPLETE_URL, token, body);
  } catch (primaryError) {
    result = await postPmVaultTopupComplete(PM_VAULT_TOPUP_COMPLETE_FALLBACK_URL, token, body);
  }

  const { response, payload } = result;
  if (!response.ok || payload.success === false) {
    if (PM_VAULT_TOPUP_COMPLETE_URL !== PM_VAULT_TOPUP_COMPLETE_FALLBACK_URL) {
      const fallback = await postPmVaultTopupComplete(PM_VAULT_TOPUP_COMPLETE_FALLBACK_URL, token, body);
      if (fallback.response.ok && fallback.payload.success !== false) {
        return unwrapPmPayload(fallback.payload) || fallback.payload;
      }
    }
    throw pmRequestFailed(response, payload, 'Failed to complete vault top-up');
  }

  return unwrapPmPayload(payload) || payload;
}

export async function assertPmVaultBalanceSufficient(user, amountInRupees, credentials = {}) {
  const pmWallet = await getPmVaultWalletView(user, credentials);
  const required = Number(amountInRupees || 0);
  if (pmWallet.balance + 0.0001 < required) {
    const err = new Error(
      `Insufficient vault balance. Available INR ${pmWallet.balance}, required INR ${required}.`
    );
    err.code = 'INSUFFICIENT_VAULT_BALANCE';
    throw err;
  }
  return pmWallet;
}

/**
 * Debit PM vault for a Tatva order (service provider or supplier buyer).
 * PM contract (official):
 *   POST {PM_PAYMENT_API_BASE_URL}/api/v1/payments/order-payment/vault-pay
 *   { orderId, userId }
 * Retries with amount if PM validation requires it (same pattern as other payment APIs).
 * @returns {Promise<{ paymentId: string|null }>}
 */
export async function payOrderFromPmVault({
  user,
  orderId,
  orderNumber = null,
  amountInRupees,
  description = 'Order payment from PM vault',
  credentials = {}
}) {
  const { accessToken, pmUserId } = await ensurePmVaultAuth(user, credentials);

  // Balance pre-check is best-effort: if PM vault GET is down, still attempt vault-pay
  // so PM can return a precise validation/balance error.
  try {
    await assertPmVaultBalanceSufficient(user, amountInRupees, credentials);
  } catch (balanceErr) {
    if (balanceErr?.code === 'INSUFFICIENT_VAULT_BALANCE') throw balanceErr;
    logger.warn('[PM vault-pay] balance pre-check skipped:', balanceErr?.message || balanceErr);
  }

  if (!PM_VAULT_PAY_ORDER_URL) {
    const err = new Error(
      'PM vault pay URL is not configured. Set PM_VAULT_PAY_ORDER_URL to the PM order-payment vault-pay endpoint.'
    );
    err.code = 'PM_VAULT_PAY_NOT_CONFIGURED';
    throw err;
  }

  const tatvaOrderId = String(orderId || '').trim();
  if (!tatvaOrderId) {
    const err = new Error('orderId is required for PM vault payment');
    err.code = 'PM_VAULT_REQUEST_FAILED';
    throw err;
  }
  if (!pmUserId) {
    const err = new Error('PM userId is required for vault payment. Sign in again with phone OTP.');
    err.code = 'PM_AUTH_REQUIRED';
    throw err;
  }

  const amountRupees = Number(amountInRupees);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    const err = new Error('Order amount must be greater than zero for vault payment');
    err.code = 'PM_VAULT_REQUEST_FAILED';
    throw err;
  }
  const amountInr = Math.round(amountRupees * 100) / 100;
  const amountPaise = Math.round(amountInr * 100);
  const payAmountInPaise =
    String(process.env.PM_VAULT_PAY_AMOUNT_IN_PAISE || 'true').trim().toLowerCase() !== 'false';
  const amountForPm = payAmountInPaise ? amountPaise : amountInr;
  const orderNo = String(orderNumber || '').trim() || null;
  const desc = String(description || 'Order payment from PM vault').trim();

  // Official PM body first. Some payment validators also require amount — retry if needed.
  const attemptBodies = [
    { orderId: tatvaOrderId, userId: pmUserId },
    {
      orderId: tatvaOrderId,
      userId: pmUserId,
      amount: amountForPm
    },
    {
      orderId: tatvaOrderId,
      userId: pmUserId,
      amount: amountForPm,
      ...(orderNo ? { orderNumber: orderNo } : {}),
      description: desc
    }
  ];

  async function postVaultPay(body) {
    logger.info('[PM vault-pay] requesting debit', {
      url: PM_VAULT_PAY_ORDER_URL,
      orderId: tatvaOrderId,
      userId: pmUserId,
      keys: Object.keys(body)
    });

    const response = await fetch(PM_VAULT_PAY_ORDER_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok || payload.success === false) {
      logger.warn('[PM vault-pay] rejected', {
        status: response.status,
        payload,
        orderId: tatvaOrderId,
        userId: pmUserId,
        keys: Object.keys(body)
      });
      throw pmRequestFailed(response, payload, 'Failed to pay order from PM vault');
    }
    return payload;
  }

  let payload = null;
  let lastError = null;
  for (let i = 0; i < attemptBodies.length; i += 1) {
    try {
      payload = await postVaultPay(attemptBodies[i]);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const isValidation =
        err?.code === 'PM_VAULT_VALIDATION_FAILED' ||
        /validation failed/i.test(String(err?.message || ''));
      const canRetry =
        isValidation &&
        i < attemptBodies.length - 1 &&
        // If PM rejected unknown keys on a richer body, do not keep adding fields.
        !(i > 0 && validationRejectsUnknownKeys(err)) &&
        validationNeedsAmount(err);
      if (!canRetry) throw err;
      logger.warn('[PM vault-pay] retrying with expanded body after validation error', {
        attempt: i + 1,
        message: err.message
      });
    }
  }
  if (lastError) throw lastError;

  const data = unwrapPmPayload(payload) || payload || {};
  const paymentId = String(
    data.paymentId ||
      data.payment_id ||
      data.transactionId ||
      data.transaction_id ||
      data.id ||
      payload.paymentId ||
      ''
  ).trim();

  return { paymentId: paymentId || null };
}

export async function getPmVaultWalletView(user, credentials = {}) {
  const { accessToken } = await ensurePmVaultAuth(user, credentials);
  const vaultPayload = await fetchPmVault({ accessToken });
  return mapPmVaultToWalletView(vaultPayload);
}

function appendOfflineVaultFile(form, file) {
  if (!file?.buffer?.length) return;
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
  form.append('documents', blob, file.originalname || 'document');
}

/**
 * POST PM offline vault credit (cash on hand / cheque / bank transfer).
 * Proxied server-side to avoid browser CORS on api.withtatva.ai.
 */
export async function addPmVaultOfflineMoney({
  pmUserId,
  accessToken,
  amountInRupees,
  subPaymentMethod = 'cash_on_hand',
  receiptNumber,
  chequeNumber,
  utrNumber,
  details = '',
  documents = []
}) {
  const token = String(accessToken || '').trim();
  const userId = String(pmUserId || '').trim();
  if (!userId || !token) {
    const error = new Error('PM vault session is missing. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const amount = Number(amountInRupees);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter a valid amount');
  }

  const method = String(subPaymentMethod || 'cash_on_hand').trim();
  const allowed = ['cash_on_hand', 'cheque', 'bank_to_bank'];
  if (!allowed.includes(method)) {
    throw new Error('Invalid offline payment method');
  }

  const form = new FormData();
  form.append('userId', userId);
  form.append('amount', String(amount));
  form.append('paymentMode', 'offline');
  form.append('subPaymentMethod', method);

  if (method === 'cash_on_hand') {
    const receipt = String(receiptNumber || '').trim();
    if (!receipt) {
      throw new Error('Receipt number is required for cash on hand payment');
    }
    form.append('receiptNumber', receipt);
    form.append('details', String(details || 'Cash collected at office').trim());
  } else if (method === 'cheque') {
    const cheque = String(chequeNumber || '').trim();
    if (!cheque) {
      throw new Error('Cheque number is required for cheque payment');
    }
    form.append('chequeNumber', cheque);
    form.append('details', String(details || 'Cheque deposit').trim());
  } else {
    const utr = String(utrNumber || '').trim();
    if (!utr) {
      throw new Error('UTR number is required for bank transfer');
    }
    form.append('utrNumber', utr);
    form.append('details', String(details || 'NEFT transfer').trim());
  }

  (Array.isArray(documents) ? documents : []).forEach((file) => {
    appendOfflineVaultFile(form, file);
  });

  const response = await fetch(PM_VAULT_ADD_MONEY_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok || payload.success === false) {
    const error = pmRequestFailed(response, payload, 'Failed to add offline vault payment on PM platform');
    error.code = payload?.code || 'PM_VAULT_OFFLINE_FAILED';
    throw error;
  }

  return unwrapPmPayload(payload) || payload;
}
