const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

/** PM users + payment hosts. Paths are identical; only the subdomain changes. */
export const PM_USERS_HOST_BY_ENV = {
  development: 'https://devopsapi.withtatva.ai/users',
  production: 'https://opsapi.withtatva.ai/users'
};

export const PM_PAYMENT_HOST_BY_ENV = {
  development: 'https://devopsapi.withtatva.ai/payment',
  production: 'https://opsapi.withtatva.ai/payment'
};

/** Every PM path used by Tatva. Same on devopsapi (dev) and opsapi (prod). */
export function buildPmApiCatalog(usersHost, paymentHost) {
  const users = normalizeUrl(usersHost);
  const payment = normalizeUrl(paymentHost);
  return {
    usersBase: users,
    paymentBase: payment,
    vendorLeads: `${users}/api/users/vendor-leads`,
    verifyGst: `${users}/api/users/verify-gst`,
    users: `${users}/api/users/`,
    usersMe: `${users}/api/users/me`,
    sendOtp: `${users}/api/auth/send-otp`,
    verifyOtp: `${users}/api/auth/verify-otp`,
    vault: `${users}/api/vault`,
    vaultTransactions: `${users}/api/vault/transactions`,
    vaultAddMoney: `${users}/api/vault/add-money`,
    address: `${users}/api/address`,
    stateByPincode: `${users}/api/google-maps/state-by-pincode`,
    vaultTopupInitiate: `${payment}/api/v1/payments/vault/topup/initiate`,
    vaultTopupComplete: `${payment}/api/v1/payments/vault/topup/complete`,
    vaultPayOrder: `${payment}/api/v1/payments/order-payment/vault-pay`
  };
}

/** Full PM API set for both environments (dev = devopsapi, prod = opsapi). */
export const PM_API_CATALOG = {
  development: buildPmApiCatalog(
    PM_USERS_HOST_BY_ENV.development,
    PM_PAYMENT_HOST_BY_ENV.development
  ),
  production: buildPmApiCatalog(
    PM_USERS_HOST_BY_ENV.production,
    PM_PAYMENT_HOST_BY_ENV.production
  )
};

/**
 * VITE_PM_API_ENV=dev | production  (preferred switch)
 * Falls back to Vite mode so production builds use opsapi automatically.
 */
export function resolvePmApiEnv(raw = import.meta.env.VITE_PM_API_ENV || import.meta.env.MODE) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'production' || value === 'prod') return 'production';
  return 'development';
}

export const PM_API_ENV = resolvePmApiEnv();
export const PM_USERS_HOST = PM_USERS_HOST_BY_ENV[PM_API_ENV];
export const PM_PAYMENT_HOST = PM_PAYMENT_HOST_BY_ENV[PM_API_ENV];

const isDevProxy =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/** PM users API base — vault lives here. */
export const PM_AUTH_BASE_URL = isDevProxy
  ? '/pm-users'
  : normalizeUrl(import.meta.env.VITE_PM_AUTH_BASE_URL || PM_USERS_HOST);

export const PM_SEND_OTP_URL = `${PM_AUTH_BASE_URL}/api/auth/send-otp`;
export const PM_VERIFY_OTP_URL = `${PM_AUTH_BASE_URL}/api/auth/verify-otp`;
export const PM_VENDOR_LEADS_URL = `${PM_AUTH_BASE_URL}/api/users/vendor-leads`;
export const PM_VERIFY_GST_URL = `${PM_AUTH_BASE_URL}/api/users/verify-gst`;
export const PM_USERS_URL = `${PM_AUTH_BASE_URL}/api/users/`;
export const PM_USERS_ME_URL = `${PM_AUTH_BASE_URL}/api/users/me`;
/** POST/GET shipping addresses on the PM users host. Called via Tatva backend to avoid CORS. */
export const PM_ADDRESS_URL = `${PM_AUTH_BASE_URL}/api/address`;
/** GET Google Maps state/address lookup by Indian pincode. Called via Tatva backend. */
export const PM_STATE_BY_PINCODE_URL = `${PM_AUTH_BASE_URL}/api/google-maps/state-by-pincode`;

export const PM_VENDOR_LEAD_VENDOR_FLAG = 'supplier';
/** Platform tenant flag — sent on all PM vault/payment APIs for DB filtering. */
export const PM_PLATFORM_FLAG = 'tatvadirect';
export const PM_VENDOR_LEAD_FLAG = PM_PLATFORM_FLAG;

export const PM_SAMPLE_PHONE = String(
  import.meta.env.VITE_PM_SAMPLE_PHONE || ''
).replace(/\D/g, '');

export const PM_AUTH_SESSION_KEY = 'pmAuthSession';

/** PM payment API — top-up initiate. */
export const PM_PAYMENT_BASE_URL = isDevProxy
  ? '/pm-payment-initiate'
  : normalizeUrl(import.meta.env.VITE_PM_PAYMENT_BASE_URL || PM_PAYMENT_HOST);

/** PM payment API — top-up complete (same payment host by default). */
export const PM_PAYMENT_COMPLETE_BASE_URL = isDevProxy
  ? '/pm-payment-complete'
  : normalizeUrl(
      import.meta.env.VITE_PM_PAYMENT_COMPLETE_BASE_URL ||
        import.meta.env.VITE_PM_PAYMENT_BASE_URL ||
        PM_PAYMENT_HOST
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
export const PM_VAULT_PAY_ORDER_URL = `${PM_PAYMENT_HOST}/api/v1/payments/order-payment/vault-pay`;

/** PM users API — offline vault add-money (same host as vault balance). */
export const PM_VAULT_OFFLINE_BASE_URL = isDevProxy
  ? '/pm-users'
  : normalizeUrl(
      import.meta.env.VITE_PM_VAULT_OFFLINE_BASE_URL ||
        import.meta.env.VITE_PM_AUTH_BASE_URL ||
        PM_USERS_HOST
    );

/** POST offline vault credit (cash on hand) — form-data. Creates a PM credit-request (approved on PM). */
export const PM_VAULT_ADD_MONEY_URL = `${PM_VAULT_OFFLINE_BASE_URL}/api/vault/add-money`;
