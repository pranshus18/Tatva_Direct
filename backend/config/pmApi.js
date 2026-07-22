const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

export const PM_API_BASE_URL = normalizeUrl(
  process.env.PM_API_BASE_URL || 'https://devopsapi.withtatva.ai/users'
);

export const PM_VENDOR_LEADS_URL = `${PM_API_BASE_URL}/api/users/vendor-leads`;
export const PM_VERIFY_GST_URL = `${PM_API_BASE_URL}/api/users/verify-gst`;

export const PM_VENDOR_LEAD_VENDOR_FLAG =
  String(process.env.PM_VENDOR_LEAD_VENDOR_FLAG || 'supplier').trim() || 'supplier';

export const PM_VENDOR_LEAD_FLAG =
  String(process.env.PM_VENDOR_LEAD_FLAG || 'tatvaopsdirect').trim() || 'tatvaopsdirect';

export const PM_USERS_URL = `${PM_API_BASE_URL}/api/users/`;
export const PM_USERS_ME_URL = `${PM_API_BASE_URL}/api/users/me`;

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
  process.env.PM_PAYMENT_COMPLETE_API_BASE_URL || 'https://api.withtatva.ai/payment'
);

export const PM_VAULT_URL = `${PM_API_BASE_URL}/api/vault`;
export const PM_VAULT_TOPUP_INITIATE_URL = `${PM_PAYMENT_API_BASE_URL}/api/v1/payments/vault/topup/initiate`;
export const PM_VAULT_TOPUP_COMPLETE_URL = `${PM_PAYMENT_COMPLETE_API_BASE_URL}/api/v1/payments/vault/topup/complete`;

/**
 * Debit buyer PM vault for a Tatva order (service provider or supplier).
 * POST body: { orderId, userId } — userId is the PM platform user id.
 */
export const PM_VAULT_PAY_ORDER_URL = normalizeUrl(
  process.env.PM_VAULT_PAY_ORDER_URL ||
    `${PM_PAYMENT_API_BASE_URL}/api/v1/payments/order-payment/vault-pay`
);

/** Offline vault credit (cash / cheque / bank) — separate PM users host. */
export const PM_VAULT_OFFLINE_API_BASE_URL = normalizeUrl(
  process.env.PM_VAULT_OFFLINE_API_BASE_URL || 'https://api.withtatva.ai/users'
);
export const PM_VAULT_ADD_MONEY_URL = `${PM_VAULT_OFFLINE_API_BASE_URL}/api/vault/add-money`;
