const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

export const PM_API_BASE_URL = normalizeUrl(
  process.env.PM_API_BASE_URL || 'https://devopsapi.withtatva.ai/users'
);

export const PM_VENDOR_LEADS_URL = `${PM_API_BASE_URL}/api/users/vendor-leads`;
export const PM_VERIFY_GST_URL = `${PM_API_BASE_URL}/api/users/verify-gst`;

export const PM_VENDOR_LEAD_VENDOR_FLAG =
  String(process.env.PM_VENDOR_LEAD_VENDOR_FLAG || 'supplier').trim() || 'supplier';

/** Platform tenant flag sent on all PM API calls so PM can filter the correct DB. */
export const PM_PLATFORM_FLAG =
  String(process.env.PM_PLATFORM_FLAG || process.env.PM_VENDOR_LEAD_FLAG || 'tatvadirect').trim() ||
  'tatvadirect';

/** @deprecated use PM_PLATFORM_FLAG — same value for vendor leads and vault/payment APIs. */
export const PM_VENDOR_LEAD_FLAG = PM_PLATFORM_FLAG;

/**
 * Append `flag=tatvadirect` (or configured PM_PLATFORM_FLAG) to a PM URL for DB filtering.
 * Always forces the platform flag (overwrites a stale/wrong flag if already present).
 */
export function withPmPlatformFlagQuery(url, flag = PM_PLATFORM_FLAG) {
  const base = String(url || '').trim();
  const resolved = String(flag || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  if (!base) return base;
  try {
    const parsed = new URL(base);
    parsed.searchParams.set('flag', resolved);
    return parsed.toString();
  } catch {
    const withoutFlag = base.replace(/([?&])flag=[^&]*/gi, '$1').replace(/[?&]$/, '');
    return `${withoutFlag}${withoutFlag.includes('?') ? '&' : '?'}flag=${encodeURIComponent(resolved)}`;
  }
}

/**
 * Merge platform flag into a JSON body for PM write APIs.
 * Sends both `flag` and `platformFlag` — PM payment services accept either.
 */
export function withPmPlatformFlagBody(body = {}, flag = PM_PLATFORM_FLAG) {
  const resolved = String(flag || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  return {
    ...(body && typeof body === 'object' ? body : {}),
    flag: resolved,
    platformFlag: resolved
  };
}

/** Headers so PM can resolve the Tatva Direct tenant even if body keys are stripped. */
export function buildPmPlatformHeaders({ accessToken, json = false, flag = PM_PLATFORM_FLAG } = {}) {
  const resolved = String(flag || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  const token = String(accessToken || '').trim();
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    flag: resolved,
    'x-flag': resolved,
    'x-platform-flag': resolved,
    'X-App-Flag': resolved
  };
}

export const PM_USERS_URL = `${PM_API_BASE_URL}/api/users/`;
export const PM_USERS_ME_URL = `${PM_API_BASE_URL}/api/users/me`;
export const PM_SEND_OTP_URL = `${PM_API_BASE_URL}/api/auth/send-otp`;
export const PM_VERIFY_OTP_URL = `${PM_API_BASE_URL}/api/auth/verify-otp`;

export const PM_USER_FLAG_SERVICE_PROVIDER = 'service_provider';
export const PM_USER_FLAG_SUPPLIER = 'supplier';

export function buildPmUserUrl(pmUserId) {
  const id = String(pmUserId || '').trim();
  if (!id) return null;
  return `${PM_API_BASE_URL}/api/users/${id}`;
}

export const PM_PAYMENT_API_BASE_URL = normalizeUrl(
  process.env.PM_PAYMENT_API_BASE_URL || 'https://devopsapi.withtatva.ai/payment'
);

export const PM_PAYMENT_COMPLETE_API_BASE_URL = normalizeUrl(
  process.env.PM_PAYMENT_COMPLETE_API_BASE_URL || PM_PAYMENT_API_BASE_URL
);

export const PM_VAULT_URL = `${PM_API_BASE_URL}/api/vault`;
/** PM vault reconciliation statement ledger — GET only (no balance fallback). */
export const PM_VAULT_TRANSACTIONS_URL = `${PM_API_BASE_URL}/api/vault/transactions`;
export const PM_VAULT_TOPUP_INITIATE_URL = `${PM_PAYMENT_API_BASE_URL}/api/v1/payments/vault/topup/initiate`;
export const PM_VAULT_TOPUP_COMPLETE_URL = `${PM_PAYMENT_COMPLETE_API_BASE_URL}/api/v1/payments/vault/topup/complete`;

/**
 * Debit buyer PM vault for a Tatva order (service provider or supplier).
 * POST body: { orderId, userId } — userId is the PM platform user id.
 * Remaps a stale guessed debit URL if still set in env from an earlier draft.
 */
const rawPmVaultPayOrderUrl = normalizeUrl(
  process.env.PM_VAULT_PAY_ORDER_URL ||
    `${PM_PAYMENT_API_BASE_URL}/api/v1/payments/order-payment/vault-pay`
);
export const PM_VAULT_PAY_ORDER_URL = /\/api\/vault\/debit\/?$/i.test(rawPmVaultPayOrderUrl)
  ? normalizeUrl(`${PM_PAYMENT_API_BASE_URL}/api/v1/payments/order-payment/vault-pay`)
  : rawPmVaultPayOrderUrl;

/**
 * Offline vault credit (cash / cheque / bank).
 * Defaults to the same PM users host as vault balance — `api.withtatva.ai`
 * is not reliably resolvable and caused ENOTFOUND in local/dev.
 */
export const PM_VAULT_OFFLINE_API_BASE_URL = normalizeUrl(
  process.env.PM_VAULT_OFFLINE_API_BASE_URL || PM_API_BASE_URL
);
export const PM_VAULT_ADD_MONEY_URL = `${PM_VAULT_OFFLINE_API_BASE_URL}/api/vault/add-money`;
/** Fallback when a custom offline host fails DNS / network. */
export const PM_VAULT_ADD_MONEY_FALLBACK_URL = `${PM_API_BASE_URL}/api/vault/add-money`;
