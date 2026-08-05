import {
  PM_PAYMENT_API_BASE_URL,
  PM_PLATFORM_FLAG,
  PM_VAULT_ADD_MONEY_FALLBACK_URL,
  PM_VAULT_ADD_MONEY_URL,
  PM_VAULT_PAY_ORDER_URL,
  PM_VAULT_TOPUP_COMPLETE_URL,
  PM_VAULT_TOPUP_INITIATE_URL,
  PM_VAULT_TRANSACTIONS_URL,
  PM_VAULT_URL,
  buildPmPlatformHeaders,
  withPmPlatformFlagBody,
  withPmPlatformFlagQuery
} from '../config/pmApi.js';
import {
  fetchPmCurrentUser,
  fetchPmUserByPhone,
  getPmAuthFromUser,
  persistPmAuthCredentials
} from './pmUserService.js';
import {
  applyPmVaultPlatformAttribution,
  extractAttributionKeysFromPmPayload,
  rememberPmVaultPlatformAttribution
} from './pmVaultPlatformAttribution.js';
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
  const credit = Number(entry?.credit ?? entry?.creditAmount ?? entry?.credit_amount ?? 0);
  const debit = Number(entry?.debit ?? entry?.debitAmount ?? entry?.debit_amount ?? 0);
  if (Number.isFinite(credit) && credit > 0 && !(Number.isFinite(debit) && debit > 0)) return 'credit';
  if (Number.isFinite(debit) && debit > 0 && !(Number.isFinite(credit) && credit > 0)) return 'debit';

  const raw =
    entry?.direction ||
    entry?.debitCredit ||
    entry?.debit_credit ||
    entry?.['Debit / Credit'] ||
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

/**
 * PM vault transaction amounts live on `credit` / `debit` (paise), not a generic `amount`.
 * Example: { credit: 5000, debit: 0, type: 'credit' } → ₹50.00
 */
function normalizePmTransactionAmount(entry) {
  const credit = Number(entry?.credit ?? entry?.creditAmount ?? entry?.credit_amount ?? 0);
  const debit = Number(entry?.debit ?? entry?.debitAmount ?? entry?.debit_amount ?? 0);
  const creditPaise = Number.isFinite(credit) ? Math.abs(credit) : 0;
  const debitPaise = Number.isFinite(debit) ? Math.abs(debit) : 0;

  if (creditPaise > 0 || debitPaise > 0) {
    return toInr(Math.max(creditPaise, debitPaise), { assumePaise: true });
  }

  if (entry?.amountInPaise !== undefined || entry?.amount_in_paise !== undefined) {
    return toInr(entry?.amountInPaise ?? entry?.amount_in_paise, { assumePaise: true });
  }

  if (
    entry?.amountInRupees !== undefined ||
    entry?.amount_in_rupees !== undefined ||
    entry?.amountInr !== undefined ||
    entry?.amountINR !== undefined
  ) {
    return toInr(
      entry?.amountInRupees ?? entry?.amount_in_rupees ?? entry?.amountInr ?? entry?.amountINR,
      { assumePaise: false }
    );
  }

  const raw = entry?.amount ?? entry?.value ?? 0;
  const numeric = Math.abs(Number(raw || 0));
  if (!Number.isFinite(numeric) || numeric === 0) return 0;

  // Same platform vault stores money in paise unless explicitly labeled INR.
  const unit = String(entry?.amountUnit || entry?.unit || '').toLowerCase();
  if (unit === 'inr' || unit === 'rupees') return numeric;
  if (unit === 'paise') return toInr(numeric, { assumePaise: true });
  if (!Number.isInteger(numeric)) return numeric;
  return toInr(numeric, { assumePaise: PM_VAULT_BALANCE_IN_PAISE });
}

function normalizePmPaymentMethod(entry) {
  const raw =
    entry?.paymentMode ||
    entry?.payment_mode ||
    entry?.paymentMethod ||
    entry?.payment_method ||
    entry?.subPaymentMethod ||
    entry?.sub_payment_method ||
    entry?.method ||
    entry?.mode ||
    '';
  const normalized = String(raw || '').trim();
  if (!normalized) return 'Wallet';
  if (/^wallet$/i.test(normalized) || /^vault$/i.test(normalized)) return 'Wallet';
  if (/^online$/i.test(normalized)) return 'Online';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizePmProjectId(entry) {
  const raw =
    entry?.projectId ||
    entry?.project_id ||
    entry?.projectCode ||
    entry?.project_code ||
    entry?.project?.id ||
    entry?.project?._id ||
    entry?.project?.code ||
    null;
  const value = normalizePmObjectId(raw);
  if (!value || value === '-' || value === '—') return null;
  return value;
}

/** Pull transaction arrays from vault payload or dedicated /vault/transactions responses. */
export function extractPmTransactionRows(payload) {
  if (Array.isArray(payload)) return payload;

  const queue = [];
  const seen = new Set();
  const push = (value) => {
    if (value == null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    queue.push(value);
  };

  push(payload);
  push(unwrapPmPayload(payload));
  push(resolveVaultRecord(payload));

  const arrayKeys = [
    'transactions',
    'transaction',
    'ledger',
    'history',
    'items',
    'rows',
    'docs',
    'results',
    'records',
    'entries',
    'list',
    'lines',
    'data',
    'vaultTransactions',
    'vault_transactions',
    'transactionList',
    'transaction_list',
    'statementTransactions',
    'statement_transactions'
  ];

  const scored = [];

  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      scored.push(node);
      continue;
    }

    for (const key of arrayKeys) {
      const value = node?.[key];
      if (Array.isArray(value)) scored.push(value);
      else if (value && typeof value === 'object') {
        // Some PM endpoints return an id→row map instead of an array.
        const values = Object.values(value);
        if (values.length && values.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
          scored.push(values);
        }
        push(value);
      }
    }

    // Nested statement / pagination containers
    for (const key of ['statement', 'reconciliation', 'reconciliationStatement', 'page', 'pagination', 'vault', 'wallet']) {
      const value = node?.[key];
      if (value && typeof value === 'object') push(value);
    }
  }

  const looksLikeTxn = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    return (
      row.amount != null ||
      row.credit != null ||
      row.debit != null ||
      row.amountInPaise != null ||
      row.value != null ||
      row.details != null ||
      row.description != null ||
      row.transactionId != null ||
      row.transaction_id != null ||
      row.debitCredit != null ||
      row.debit_credit != null ||
      row.direction != null ||
      row.type != null ||
      row.paymentMethod != null ||
      row.payment_method != null ||
      row.paymentMode != null ||
      row.projectId != null ||
      row.project_id != null ||
      row.createdAt != null ||
      row.created_at != null ||
      row.transactionDate != null ||
      row.date != null ||
      row._id != null ||
      row.id != null
    );
  };

  // Prefer non-empty arrays that look like transaction rows.
  const ranked = scored
    .filter((arr) => Array.isArray(arr) && arr.length > 0)
    .sort((a, b) => {
      const aScore = a.filter(looksLikeTxn).length;
      const bScore = b.filter(looksLikeTxn).length;
      if (bScore !== aScore) return bScore - aScore;
      return b.length - a.length;
    });

  if (ranked.length) return ranked[0];

  // Empty but explicit transactions array still wins over unrelated empties.
  for (const arr of scored) {
    if (Array.isArray(arr)) return arr;
  }
  return [];
}

function summarizePayloadShape(payload, depth = 0, maxDepth = 3) {
  if (payload == null) return null;
  if (Array.isArray(payload)) {
    return {
      type: 'array',
      length: payload.length,
      sampleKeys:
        payload[0] && typeof payload[0] === 'object' ? Object.keys(payload[0]).slice(0, 20) : []
    };
  }
  if (typeof payload !== 'object') return { type: typeof payload };
  if (depth >= maxDepth) return { type: 'object', keys: Object.keys(payload).slice(0, 30) };

  const out = { type: 'object', keys: Object.keys(payload).slice(0, 40), children: {} };
  for (const key of Object.keys(payload).slice(0, 20)) {
    out.children[key] = summarizePayloadShape(payload[key], depth + 1, maxDepth);
  }
  return out;
}

export function mapPmVaultTransactions(vaultOrPayload) {
  const rows = extractPmTransactionRows(vaultOrPayload);

  return rows.map((entry, index) => {
    const direction = normalizePmTransactionDirection(entry);
    const amount = normalizePmTransactionAmount(entry);
    const createdAt =
      entry?.transactionDate ||
      entry?.transaction_date ||
      entry?.createdAt ||
      entry?.created_at ||
      entry?.timestamp ||
      entry?.date ||
      entry?.txnDate ||
      new Date().toISOString();
    const description = String(
      entry?.details ||
        entry?.description ||
        entry?.note ||
        entry?.purpose ||
        entry?.title ||
        entry?.narrative ||
        'Vault transaction'
    );
    // PM UI Transaction ID column uses the mongo `id`; `transactionId` is the VTX reference.
    const recordId = String(entry?.id || entry?._id || `pm-txn-${index}`);
    const vtxReference = String(entry?.transactionId || entry?.transaction_id || '').trim() || null;
    const transactionId = recordId;
    const projectId = normalizePmProjectId(entry);
    const paymentMethod = normalizePmPaymentMethod(entry);
    const creditPaise = Number(entry?.credit ?? entry?.creditAmount ?? 0) || 0;
    const debitPaise = Number(entry?.debit ?? entry?.debitAmount ?? 0) || 0;

    return {
      id: transactionId,
      transaction_id: transactionId,
      transactionId: vtxReference || transactionId,
      reference: vtxReference,
      created_at: createdAt,
      date: createdAt,
      details: description,
      description,
      transaction_type: String(
        entry?.transactionType || entry?.type || entry?.category || entry?.details || 'wallet'
      ),
      direction,
      debit_credit: direction === 'credit' ? 'Credit' : 'Debit',
      amount,
      credit: toInr(Math.abs(creditPaise), { assumePaise: true }),
      debit: toInr(Math.abs(debitPaise), { assumePaise: true }),
      payment_method: paymentMethod,
      paymentMethod,
      payment_mode: entry?.paymentMode || entry?.payment_mode || null,
      sub_payment_method: entry?.subPaymentMethod || entry?.sub_payment_method || null,
      project_id: projectId,
      projectId,
      milestone_sequence:
        entry?.milestoneSequence ?? entry?.milestone_sequence ?? entry?.milestone ?? null,
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
            entry?.balanceAfter !== undefined ||
            entry?.balance_after !== undefined ||
            PM_VAULT_BALANCE_IN_PAISE
        }
      ),
      balance_before: toInr(entry?.balanceBefore ?? entry?.balance_before ?? 0, {
        assumePaise:
          entry?.balanceBeforeInPaise !== undefined ||
          entry?.balanceBefore !== undefined ||
          PM_VAULT_BALANCE_IN_PAISE
      }),
      orderId: entry?.orderId || entry?.order_id || null,
      orderNumber: entry?.orderNumber || entry?.order_number || null,
      paymentId: entry?.paymentId || entry?.payment_id || null,
      vaultId: entry?.vaultId || entry?.vault_id || null,
      flag: entry?.flag || null,
      chequeNumber: entry?.chequeNumber || entry?.cheque_number || null,
      utrNumber: entry?.utrNumber || entry?.utr_number || null,
      receiptNumber: entry?.receiptNumber || entry?.receipt_number || null,
      proofDocuments: Array.isArray(entry?.proofDocuments) ? entry.proofDocuments : [],
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

  // Balance-only view from GET /api/vault — never use this for reconciliation.
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
    raw: vault
  };
}

export async function fetchPmVault({ accessToken, flag = null } = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('PM session expired. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  // Balance reads are user-scoped via Bearer token. Do not filter by platform flag
  // so the shared vault balance includes activity from every Tatva app.
  const resolvedFlag = flag == null ? '' : String(flag).trim();
  const url = resolvedFlag ? withPmPlatformFlagQuery(PM_VAULT_URL, resolvedFlag) : PM_VAULT_URL;
  logger.info('[PM vault] GET balance', { url });

  const response = await fetch(url, {
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

/**
 * GET PM vault reconciliation ledger:
 * https://devopsapi.withtatva.ai/users/api/vault/transactions
 *
 * Reads return ALL platforms' transactions for the signed-in user (Bearer-scoped).
 * Do not pass ?flag=… on this GET — that filters the ledger down to one tenant and
 * hides cross-platform activity. Writes still send flag=tatvadirect.
 */
export async function fetchPmVaultTransactions({
  accessToken,
  flag = null,
  query = {}
} = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const error = new Error('PM session expired. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const params = new URLSearchParams();
  const resolvedFlag = flag == null ? '' : String(flag).trim();
  // Only attach flag when explicitly requested (not the default reconciliation path).
  if (resolvedFlag) params.set('flag', resolvedFlag);

  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === '') continue;
    if (key === 'flag') continue;
    params.set(key, String(value));
  }

  const url = params.toString()
    ? `${PM_VAULT_TRANSACTIONS_URL}?${params.toString()}`
    : PM_VAULT_TRANSACTIONS_URL;

  logger.info('[PM vault transactions] GET', { url, flag: resolvedFlag || null });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok || payload.success === false) {
    throw pmRequestFailed(response, payload, 'Failed to load vault transactions');
  }

  return payload;
}

function normalizePmTransactionLimit(raw, fallback = 100) {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 200));
}

function pmTransactionRowKey(row = {}) {
  return String(
    row.id || row.transaction_id || row.transactionId || row.reference || ''
  ).trim();
}

/** Merge PM ledger pages without duplicating rows when paginating. */
export function mergePmVaultTransactionPages(existing = [], incoming = []) {
  const seen = new Set(
    (Array.isArray(existing) ? existing : [])
      .map(pmTransactionRowKey)
      .filter(Boolean)
  );
  const merged = [...(Array.isArray(existing) ? existing : [])];
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const key = pmTransactionRowKey(row);
    if (key && seen.has(key)) continue;
    merged.push(row);
    if (key) seen.add(key);
  }
  return merged;
}

/** Read pagination metadata from PM /vault/transactions payloads. */
export function extractPmTransactionPageInfo(payload) {
  const node = unwrapPmPayload(payload) || payload || {};
  const pagination =
    (node.pagination && typeof node.pagination === 'object' ? node.pagination : null) ||
    (node.pageInfo && typeof node.pageInfo === 'object' ? node.pageInfo : null) ||
    (node.meta && typeof node.meta === 'object' ? node.meta : null) ||
    node;

  const nextCursorRaw =
    pagination.nextCursor ??
    pagination.next_cursor ??
    pagination.nextPageCursor ??
    pagination.next ??
    node.nextCursor ??
    node.next_cursor ??
    null;
  const nextCursor =
    nextCursorRaw == null || nextCursorRaw === '' ? null : String(nextCursorRaw).trim() || null;

  const totalDocs = Number(
    pagination.totalDocs ?? pagination.total ?? pagination.totalCount ?? node.totalDocs ?? NaN
  );
  const limit = Number(pagination.limit ?? pagination.pageSize ?? node.limit ?? NaN);
  const page = Number(pagination.page ?? pagination.currentPage ?? node.page ?? NaN);
  const currentCount = extractPmTransactionRows(payload).length;

  let inferredHasMore = false;
  if (Number.isFinite(totalDocs) && totalDocs > 0) {
    if (Number.isFinite(limit) && Number.isFinite(page)) {
      inferredHasMore = page * limit < totalDocs;
    } else if (Number.isFinite(limit) && currentCount >= limit) {
      inferredHasMore = true;
    }
  }

  const explicitHasMore =
    pagination.hasNextPage ??
    pagination.has_next_page ??
    pagination.hasMore ??
    pagination.has_more ??
    node.hasNextPage ??
    node.has_next_page ??
    node.hasMore ??
    node.has_more ??
    null;

  const hasMore = Boolean(explicitHasMore ?? (nextCursor ? true : inferredHasMore));

  return {
    hasMore,
    nextCursor,
    totalCount: Number.isFinite(totalDocs) ? totalDocs : null
  };
}

/**
 * Reconciliation statement — full cross-platform ledger for the user.
 * PM GET /api/vault/transactions (no flag filter).
 */
export async function getPmVaultTransactions(user, credentials = {}, options = {}) {
  const { accessToken } = await ensurePmVaultAuth(user, credentials);
  // Default null = all platforms. Pass options.flag only when a caller wants a filter.
  const flag =
    options.flag === undefined || options.flag === null || String(options.flag).trim() === ''
      ? null
      : String(options.flag).trim();

  const hasExplicitLimit = options.limit != null && String(options.limit).trim() !== '';
  const hasExplicitCursor = options.cursor != null && String(options.cursor).trim() !== '';
  const fetchAll =
    options.fetchAll !== false && !hasExplicitLimit && !hasExplicitCursor;
  const pageLimit = hasExplicitLimit ? normalizePmTransactionLimit(options.limit) : 100;

  const baseQuery = {
    from: options.from || options.fromDate || undefined,
    to: options.to || options.toDate || undefined,
    search: options.search || undefined
  };

  let transactions = [];
  let lastPayload = null;
  let pageInfo = { hasMore: false, nextCursor: null, totalCount: null };
  let cursor = hasExplicitCursor ? String(options.cursor).trim() : undefined;
  let page = 1;
  let pagesFetched = 0;
  const maxPages = fetchAll ? 50 : 1;

  do {
    const query = {
      ...baseQuery,
      limit: pageLimit,
      ...(cursor ? { cursor } : {}),
      ...(fetchAll && !cursor && page > 1 ? { page } : {})
    };

    const payload = await fetchPmVaultTransactions({
      accessToken,
      flag,
      query
    });
    lastPayload = payload;

    const pageRows = applyPmVaultPlatformAttribution(mapPmVaultTransactions(payload));
    transactions = mergePmVaultTransactionPages(transactions, pageRows);
    pageInfo = extractPmTransactionPageInfo(payload);
    pagesFetched += 1;

    if (!fetchAll || !pageInfo.hasMore || pagesFetched >= maxPages) break;

    if (pageInfo.nextCursor) {
      cursor = pageInfo.nextCursor;
      page += 1;
      continue;
    }

    if (Number.isFinite(Number(payload?.data?.page ?? payload?.page)) && pageRows.length >= pageLimit) {
      page = Number(payload?.data?.page ?? payload?.page ?? page) + 1;
      cursor = undefined;
      continue;
    }

    break;
  } while (fetchAll && pageInfo.hasMore);

  logger.info('[PM vault transactions] mapped rows', {
    count: transactions.length,
    pagesFetched,
    fetchAll,
    flag,
    sampleAmount: transactions[0]?.amount,
    sampleDetails: transactions[0]?.details,
    sampleFlag: transactions[0]?.flag
  });

  return {
    transactions,
    summary: summarizePmVaultLedger(transactions),
    raw: lastPayload,
    pageInfo: fetchAll
      ? { hasMore: false, nextCursor: null, totalCount: pageInfo.totalCount ?? transactions.length }
      : pageInfo,
    source: 'pm_vault_transactions',
    upstream: PM_VAULT_TRANSACTIONS_URL,
    flag
  };
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

  const baseDescription = String(description || 'Vault top-up').trim() || 'Vault top-up';
  // Embed platform in details so reconciliation can recover tatvadirect if PM ignores body.flag.
  const taggedDescription = /\btatvadirect\b/i.test(baseDescription)
    ? baseDescription
    : `${baseDescription} (${PM_PLATFORM_FLAG})`;

  const topupBody = withPmPlatformFlagBody({
    userId,
    amount: pmAmount,
    description: taggedDescription
  });
  const topupUrl = withPmPlatformFlagQuery(PM_VAULT_TOPUP_INITIATE_URL);

  logger.info('[PM vault topup initiate] requesting', {
    url: topupUrl,
    flag: topupBody.flag,
    userId,
    amount: pmAmount
  });

  const response = await fetch(topupUrl, {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken: token, json: true }),
    body: JSON.stringify(topupBody)
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

  if (orderId) {
    rememberPmVaultPlatformAttribution({ razorpayOrderId: orderId });
  }
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
  const completeBody = withPmPlatformFlagBody(body);
  const completeUrl = withPmPlatformFlagQuery(url);
  logger.info('[PM vault topup complete] requesting', {
    url: completeUrl,
    flag: completeBody.flag,
    platformFlag: completeBody.platformFlag,
    keys: Object.keys(completeBody),
    body: {
      razorpay_order_id: completeBody.razorpay_order_id,
      razorpay_payment_id: completeBody.razorpay_payment_id,
      flag: completeBody.flag,
      platformFlag: completeBody.platformFlag,
      details: completeBody.details
    }
  });
  const response = await fetch(completeUrl, {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken: token, json: true }),
    body: JSON.stringify(completeBody)
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

  // Always stamp tatvadirect so PM tenant routing / ledger attribution can use it.
  const body = withPmPlatformFlagBody({
    razorpay_order_id: String(razorpayOrderId || '').trim(),
    razorpay_payment_id: String(razorpayPaymentId || '').trim(),
    razorpay_signature: String(razorpaySignature || '').trim(),
    flag: PM_PLATFORM_FLAG,
    platformFlag: PM_PLATFORM_FLAG,
    details: `Vault top-up via Razorpay (${PM_PLATFORM_FLAG})`
  });

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
        const completed = unwrapPmPayload(fallback.payload) || fallback.payload;
        rememberPmVaultPlatformAttribution({
          razorpayOrderId,
          razorpayPaymentId,
          ...extractAttributionKeysFromPmPayload(completed)
        });
        return completed;
      }
    }
    throw pmRequestFailed(response, payload, 'Failed to complete vault top-up');
  }

  const completed = unwrapPmPayload(payload) || payload;
  rememberPmVaultPlatformAttribution({
    razorpayOrderId,
    razorpayPaymentId,
    ...extractAttributionKeysFromPmPayload(completed)
  });
  return completed;
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
 * Resolve a Tatva user's PM platform user id from stored profile/auth or phone directory lookup.
 */
export async function resolvePmUserIdForTatvaUser(user) {
  if (!user) return null;
  const stored = getPmAuthFromUser(user);
  const fromProfile = user?.profile?.pmCustomerProfile?.pmUserId;
  const direct = normalizePmObjectId(stored?.pmUserId || fromProfile || '');
  if (direct) return direct;

  const phone = normalizeIndianMobile(user?.phone || user?.profile?.pmCustomerProfile?.phoneNumber);
  if (phone.length !== 10) return null;

  const pmUser = await fetchPmUserByPhone(phone);
  return normalizePmObjectId(pmUser?._id || pmUser?.id || pmUser?.userId || '');
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
  supplierPmUserId = null,
  supplierPayoutAmountInRupees = null,
  platformFeeAmountInRupees = null,
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
  const supplierUserId = String(supplierPmUserId || '').trim() || null;
  const supplierPayoutForPm =
    supplierPayoutAmountInRupees != null && Number(supplierPayoutAmountInRupees) > 0
      ? payAmountInPaise
        ? Math.round(Number(supplierPayoutAmountInRupees) * 100)
        : Math.round(Number(supplierPayoutAmountInRupees) * 100) / 100
      : null;
  const platformFeeForPm =
    platformFeeAmountInRupees != null && Number(platformFeeAmountInRupees) > 0
      ? payAmountInPaise
        ? Math.round(Number(platformFeeAmountInRupees) * 100)
        : Math.round(Number(platformFeeAmountInRupees) * 100) / 100
      : null;

  // Official PM body first. Some payment validators also require amount — retry if needed.
  // Always include platform flag so PM routes the debit to the Tatva Direct DB.
  const attemptBodies = [
    withPmPlatformFlagBody({ orderId: tatvaOrderId, userId: pmUserId }),
    withPmPlatformFlagBody({
      orderId: tatvaOrderId,
      userId: pmUserId,
      amount: amountForPm
    }),
    withPmPlatformFlagBody({
      orderId: tatvaOrderId,
      userId: pmUserId,
      amount: amountForPm,
      ...(orderNo ? { orderNumber: orderNo } : {}),
      description: desc
    }),
    ...(supplierUserId && supplierPayoutForPm != null
      ? [
          withPmPlatformFlagBody({
            orderId: tatvaOrderId,
            userId: pmUserId,
            amount: amountForPm,
            supplierUserId,
            supplierPayoutAmount: supplierPayoutForPm,
            ...(platformFeeForPm != null ? { platformFeeAmount: platformFeeForPm } : {}),
            ...(orderNo ? { orderNumber: orderNo } : {}),
            description: desc
          })
        ]
      : [])
  ];

  async function postVaultPay(body) {
    const payUrl = withPmPlatformFlagQuery(PM_VAULT_PAY_ORDER_URL);
    logger.info('[PM vault-pay] requesting debit', {
      url: payUrl,
      orderId: tatvaOrderId,
      userId: pmUserId,
      flag: body.flag || PM_PLATFORM_FLAG,
      keys: Object.keys(body)
    });

    const response = await fetch(payUrl, {
      method: 'POST',
      headers: buildPmPlatformHeaders({ accessToken, json: true }),
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

  rememberPmVaultPlatformAttribution({
    orderId: tatvaOrderId,
    orderNumber: orderNo,
    paymentId: paymentId || null,
    ...extractAttributionKeysFromPmPayload(data)
  });

  return { paymentId: paymentId || null, buyerPmUserId: pmUserId };
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

function isUpstreamNetworkError(err) {
  const code = err?.cause?.code || err?.code || '';
  const message = String(err?.message || '');
  return (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/i.test(
      String(code)
    ) || /fetch failed|network/i.test(message)
  );
}

function buildOfflineVaultAddMoneyForm({
  userId,
  amount,
  method,
  receiptNumber,
  chequeNumber,
  utrNumber,
  details,
  documents
}) {
  const form = new FormData();
  form.append('userId', userId);
  form.append('amount', String(amount));
  form.append('paymentMode', 'offline');
  form.append('subPaymentMethod', method);
  form.append('flag', PM_PLATFORM_FLAG);
  form.append('platformFlag', PM_PLATFORM_FLAG);

  if (method === 'cash_on_hand') {
    form.append('receiptNumber', String(receiptNumber || '').trim());
    form.append('details', tagOfflineDetails(details || 'Cash collected at office'));
  } else if (method === 'cheque') {
    form.append('chequeNumber', String(chequeNumber || '').trim());
    form.append('details', tagOfflineDetails(details || 'Cheque deposit'));
  } else {
    form.append('utrNumber', String(utrNumber || '').trim());
    form.append('details', tagOfflineDetails(details || 'NEFT transfer'));
  }

  (Array.isArray(documents) ? documents : []).forEach((file) => {
    appendOfflineVaultFile(form, file);
  });

  return form;
}

async function postPmVaultOfflineAddMoney(addMoneyUrl, token, form) {
  const response = await fetch(addMoneyUrl, {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken: token, json: false }),
    body: form
  });
  const payload = await parseJsonResponse(response);
  return { response, payload };
}

/**
 * POST PM offline vault credit (cash on hand / cheque / bank transfer).
 * Proxied server-side to avoid browser CORS. Uses devopsapi users host by default;
 * falls back to PM_API_BASE_URL if a custom offline host fails DNS/network.
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

  if (method === 'cash_on_hand' && !String(receiptNumber || '').trim()) {
    throw new Error('Receipt number is required for cash on hand payment');
  }
  if (method === 'cheque' && !String(chequeNumber || '').trim()) {
    throw new Error('Cheque number is required for cheque payment');
  }
  if (method === 'bank_to_bank' && !String(utrNumber || '').trim()) {
    throw new Error('UTR number is required for bank transfer');
  }

  const formArgs = {
    userId,
    amount,
    method,
    receiptNumber,
    chequeNumber,
    utrNumber,
    details,
    documents
  };

  const primaryUrl = withPmPlatformFlagQuery(PM_VAULT_ADD_MONEY_URL);
  const fallbackUrl = withPmPlatformFlagQuery(PM_VAULT_ADD_MONEY_FALLBACK_URL);

  logger.info('[PM vault offline add-money] requesting', {
    url: primaryUrl,
    flag: PM_PLATFORM_FLAG,
    userId,
    amount,
    method
  });

  let result;
  try {
    result = await postPmVaultOfflineAddMoney(
      primaryUrl,
      token,
      buildOfflineVaultAddMoneyForm(formArgs)
    );
  } catch (primaryError) {
    if (primaryUrl !== fallbackUrl && isUpstreamNetworkError(primaryError)) {
      logger.warn('[PM vault offline add-money] primary host failed; retrying fallback', {
        primaryUrl,
        fallbackUrl,
        error: primaryError?.cause?.code || primaryError?.code || primaryError?.message
      });
      result = await postPmVaultOfflineAddMoney(
        fallbackUrl,
        token,
        buildOfflineVaultAddMoneyForm(formArgs)
      );
    } else {
      throw primaryError;
    }
  }

  const { response, payload } = result;
  if (!response.ok || payload.success === false) {
    const error = pmRequestFailed(response, payload, 'Failed to add offline vault payment on PM platform');
    error.code = payload?.code || 'PM_VAULT_OFFLINE_FAILED';
    throw error;
  }

  const completed = unwrapPmPayload(payload) || payload;
  rememberPmVaultPlatformAttribution({
    paymentId: receiptNumber || chequeNumber || utrNumber || null,
    ...extractAttributionKeysFromPmPayload(completed),
    extra: [receiptNumber, chequeNumber, utrNumber].filter(Boolean)
  });
  return completed;
}

function tagOfflineDetails(details) {
  const text = String(details || '').trim() || 'Offline vault credit';
  return /\btatvadirect\b/i.test(text) ? text : `${text} (${PM_PLATFORM_FLAG})`;
}
