import {
  PM_PLATFORM_FLAG,
  PM_VAULT_ADD_MONEY_URL,
  PM_VAULT_TOPUP_COMPLETE_URL,
  PM_VAULT_TOPUP_INITIATE_URL,
  PM_VAULT_URL,
  buildPmPlatformHeaders,
  withPmPlatformFlagBody,
  withPmPlatformFlagQuery
} from '../config/pmAuth';
import { getPmCustomerCredentials } from '../utils/pmAuthSession';
import { restorePmVaultSession } from './pmAuthService';
import { mapPmTopupInitiatePayload, mapPmVaultPayload } from '../utils/pmVaultMapper';

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function ensurePmVaultCredentials() {
  await restorePmVaultSession({ force: true });
  const { accessToken, pmUserId } = getPmCustomerCredentials();
  if (!accessToken) {
    const error = new Error('PM vault session missing. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }
  return { accessToken, pmUserId };
}

/** GET PM vault balance on the active env host (devopsapi locally, opsapi in production). */
export async function fetchPmVaultRaw() {
  const { accessToken } = await ensurePmVaultCredentials();
  const response = await fetch(withPmPlatformFlagQuery(PM_VAULT_URL), {
    headers: buildPmPlatformHeaders({ accessToken })
  });
  const data = await parseJsonResponse(response);
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || 'Failed to load vault from PM platform');
    error.code = response.status === 401 ? 'PM_AUTH_REQUIRED' : 'PM_VAULT_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function fetchPmVaultView() {
  const raw = await fetchPmVaultRaw();
  return mapPmVaultPayload(raw);
}

/** POST PM payment vault top-up initiate on the active env host. */
export async function initiatePmVaultTopup({ amountInRupees, description = 'Vault top-up' }) {
  const { accessToken, pmUserId } = await ensurePmVaultCredentials();
  if (!pmUserId) {
    const error = new Error('PM user id missing. Sign in again with phone OTP.');
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const amountInr = Math.round(Number(amountInRupees || 0) * 100) / 100;
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new Error('Enter a valid amount in Indian rupees');
  }

  const response = await fetch(withPmPlatformFlagQuery(PM_VAULT_TOPUP_INITIATE_URL), {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken, json: true }),
    body: JSON.stringify(
      withPmPlatformFlagBody({
        userId: pmUserId,
        // PM initiate expects paise; UI/app always uses INR rupees.
        amount: Math.round(amountInr * 100),
        description
      })
    )
  });
  const data = await parseJsonResponse(response);
  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Failed to initiate vault top-up on PM platform');
  }
  return mapPmTopupInitiatePayload(data, amountInr);
}

/** POST PM payment vault top-up complete on the active env host. */
export async function completePmVaultTopup({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
}) {
  const { accessToken } = await ensurePmVaultCredentials();
  const response = await fetch(withPmPlatformFlagQuery(PM_VAULT_TOPUP_COMPLETE_URL), {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken, json: true }),
    body: JSON.stringify(
      withPmPlatformFlagBody({
        razorpay_order_id: String(razorpayOrderId || '').trim(),
        razorpay_payment_id: String(razorpayPaymentId || '').trim(),
        razorpay_signature: String(razorpaySignature || '').trim()
      })
    )
  });
  const data = await parseJsonResponse(response);
  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Failed to complete vault top-up on PM platform');
  }
  return data;
}

/**
 * POST PM vault add-money on the active env users host.
 * Offline vault credit — multipart form-data.
 * Prefer Tatva proxy: POST /api/vault/offline/add-money (vaultService).
 * subPaymentMethod: cash_on_hand | cheque | bank_to_bank
 */
export async function addPmVaultOfflineMoney({
  amountInRupees,
  subPaymentMethod = 'cash_on_hand',
  receiptNumber,
  chequeNumber,
  utrNumber,
  details = '',
  documents = []
}) {
  const { accessToken, pmUserId } = await ensurePmVaultCredentials();
  if (!pmUserId) {
    const error = new Error('PM user id missing. Sign in again with phone OTP.');
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
  form.append('userId', pmUserId);
  form.append('amount', String(amount));
  form.append('paymentMode', 'offline');
  form.append('subPaymentMethod', method);
  form.append('flag', PM_PLATFORM_FLAG);
  form.append('platformFlag', PM_PLATFORM_FLAG);

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
  } else if (method === 'bank_to_bank') {
    const utr = String(utrNumber || '').trim();
    if (!utr) {
      throw new Error('UTR number is required for bank transfer');
    }
    form.append('utrNumber', utr);
    form.append('details', String(details || 'NEFT transfer').trim());
  }

  const fileList = Array.isArray(documents) ? documents : documents ? [documents] : [];
  fileList.forEach((file) => {
    if (file instanceof File) {
      form.append('documents', file);
    }
  });

  const response = await fetch(withPmPlatformFlagQuery(PM_VAULT_ADD_MONEY_URL), {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken }),
    body: form
  });
  const data = await parseJsonResponse(response);
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || 'Failed to add offline vault payment on PM platform');
    error.code = data.code || 'PM_VAULT_OFFLINE_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}
