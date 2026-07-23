const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const isDevProxy =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/** PM users API base — vault lives here. */
export const PM_AUTH_BASE_URL = isDevProxy
  ? '/pm-users'
  : normalizeUrl(import.meta.env.VITE_PM_AUTH_BASE_URL || 'https://devopsapi.withtatva.ai/users');

export const PM_SEND_OTP_URL = `${PM_AUTH_BASE_URL}/api/auth/send-otp`;
export const PM_VERIFY_OTP_URL = `${PM_AUTH_BASE_URL}/api/auth/verify-otp`;
export const PM_VENDOR_LEADS_URL = `${PM_AUTH_BASE_URL}/api/users/vendor-leads`;
export const PM_VERIFY_GST_URL = `${PM_AUTH_BASE_URL}/api/users/verify-gst`;

export const PM_VENDOR_LEAD_VENDOR_FLAG = 'supplier';
/** Platform tenant flag — sent on all PM vault/payment APIs for DB filtering. */
export const PM_PLATFORM_FLAG = 'tatvadirect';
export const PM_VENDOR_LEAD_FLAG = PM_PLATFORM_FLAG;

export const PM_SAMPLE_PHONE = String(
  import.meta.env.VITE_PM_SAMPLE_PHONE || ''
).replace(/\D/g, '');

export const PM_AUTH_SESSION_KEY = 'pmAuthSession';

/** PM payment API — top-up initiate (devopsapi). */
export const PM_PAYMENT_BASE_URL = isDevProxy
  ? '/pm-payment-initiate'
  : normalizeUrl(import.meta.env.VITE_PM_PAYMENT_BASE_URL || 'https://devopsapi.withtatva.ai/payment');

/** PM payment API — top-up complete (api.withtatva.ai). */
export const PM_PAYMENT_COMPLETE_BASE_URL = isDevProxy
  ? '/pm-payment-complete'
  : normalizeUrl(
      import.meta.env.VITE_PM_PAYMENT_COMPLETE_BASE_URL || 'https://api.withtatva.ai/payment'
    );

/** GET vault balance + ledger — PM platform. */
export const PM_VAULT_URL = `${PM_AUTH_BASE_URL}/api/vault`;

/** GET vault reconciliation transactions — PM platform (`flag=tatvadirect`). */
export const PM_VAULT_TRANSACTIONS_URL = `${PM_AUTH_BASE_URL}/api/vault/transactions`;

/** POST initiate Razorpay vault top-up. */
export const PM_VAULT_TOPUP_INITIATE_URL = `${PM_PAYMENT_BASE_URL}/api/v1/payments/vault/topup/initiate`;

/** POST complete vault top-up after Razorpay. */
export const PM_VAULT_TOPUP_COMPLETE_URL = `${PM_PAYMENT_COMPLETE_BASE_URL}/api/v1/payments/vault/topup/complete`;

/**
 * Order debit is proxied by Tatva backend (not called from the browser):
 * POST /api/vault/orders/:id/pay
 *   → PM POST .../payment/api/v1/payments/order-payment/vault-pay
 *   body: { orderId, userId }  // userId = PM user id for SP or supplier
 */

/** PM users API (api.withtatva.ai) — offline vault add-money. */
export const PM_VAULT_OFFLINE_BASE_URL = isDevProxy
  ? '/pm-users-offline'
  : normalizeUrl(
      import.meta.env.VITE_PM_VAULT_OFFLINE_BASE_URL || 'https://api.withtatva.ai/users'
    );

/** POST offline vault credit (cash on hand) — form-data. */
export const PM_VAULT_ADD_MONEY_URL = `${PM_VAULT_OFFLINE_BASE_URL}/api/vault/add-money`;
