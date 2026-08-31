const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

export const PM_DEV_HOST = 'devopsapi.withtatva.ai';
export const PM_PROD_HOST = 'opsapi.withtatva.ai';

/** PM users + payment hosts. Paths are identical; only the subdomain changes. */
export const PM_USERS_HOST_BY_ENV = {
  development: `https://${PM_DEV_HOST}/users`,
  production: `https://${PM_PROD_HOST}/users`
};

export const PM_PAYMENT_HOST_BY_ENV = {
  development: `https://${PM_DEV_HOST}/payment`,
  production: `https://${PM_PROD_HOST}/payment`
};

/** Every PM path used by Tatva. Same on devopsapi (dev) and opsapi (prod). */
export function buildPmApiCatalog(usersHost, paymentHost, paymentCompleteHost = paymentHost) {
  const users = normalizeUrl(usersHost);
  const payment = normalizeUrl(paymentHost);
  const paymentComplete = normalizeUrl(paymentCompleteHost || paymentHost);
  return {
    usersBase: users,
    paymentBase: payment,
    vendorLeads: `${users}/api/users/vendor-leads`,
    verifyGst: `${users}/api/users/verify-gst`,
    users: `${users}/api/users/`,
    usersMe: `${users}/api/users/me`,
    sendOtp: `${users}/api/auth/send-otp`,
    verifyOtp: `${users}/api/auth/verify-otp`,
    refresh: `${users}/api/auth/refresh`,
    vault: `${users}/api/vault`,
    vaultTransactions: `${users}/api/vault/transactions`,
    vaultAddMoney: `${users}/api/vault/add-money`,
    address: `${users}/api/address`,
    stateByPincode: `${users}/api/google-maps/state-by-pincode`,
    vaultTopupInitiate: `${payment}/api/v1/payments/vault/topup/initiate`,
    vaultTopupComplete: `${paymentComplete}/api/v1/payments/vault/topup/complete`,
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
 * Tatva frontends → which PM server to call.
 *   prod  https://direct.withtatva.ai              → opsapi
 *   dev   https://tatva-direct-frontend-five.vercel.app → devopsapi
 *   local localhost                               → devopsapi
 */
export const TATVA_PROD_FRONTENDS = ['direct.withtatva.ai', 'www.direct.withtatva.ai'];
export const TATVA_DEV_FRONTENDS = [
  'localhost',
  '127.0.0.1',
  'tatva-direct-frontend-five.vercel.app'
];

export function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return raw.split('/')[0].split(':')[0].replace(/^www\./, '');
}

export function pmEnvFromTatvaHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  if (host === 'direct.withtatva.ai') return 'production';
  if (TATVA_PROD_FRONTENDS.map(normalizeHostname).includes(host)) return 'production';
  if (host === 'localhost' || host === '127.0.0.1') return 'development';
  if (host === 'tatva-direct-frontend-five.vercel.app') return 'development';
  if (host.endsWith('.vercel.app') && host.includes('tatva-direct-frontend-five')) {
    return 'development';
  }
  return null;
}

/**
 * Resolve PM environment for this Tatva site.
 * Hostname wins so the Vercel *dev* production build still uses devopsapi.
 */
export function resolvePmApiEnv(
  raw = import.meta.env.VITE_PM_API_ENV,
  mode = import.meta.env.MODE,
  hostname = typeof window !== 'undefined' ? window.location.hostname : ''
) {
  const fromHost = pmEnvFromTatvaHostname(hostname);
  if (fromHost) return fromHost;
  const explicit = String(raw || '').trim().toLowerCase();
  if (explicit === 'production' || explicit === 'prod') return 'production';
  if (explicit === 'dev' || explicit === 'development') return 'development';
  const viteMode = String(mode || '').trim().toLowerCase();
  if (viteMode === 'production' || viteMode === 'prod') return 'production';
  return 'development';
}

export function remapPmUrlToEnv(url, pmEnv) {
  const value = normalizeUrl(url);
  if (!value) return value;
  const targetHost = pmEnv === 'production' ? PM_PROD_HOST : PM_DEV_HOST;
  const otherHost = pmEnv === 'production' ? PM_DEV_HOST : PM_PROD_HOST;
  if (!value.includes(otherHost)) return value;
  return value.split(otherHost).join(targetHost);
}

export function resolvePmBaseUrl(envValue, catalogValue, pmEnv) {
  const catalog = normalizeUrl(catalogValue);
  const override = normalizeUrl(envValue);
  if (!override) return catalog;
  return remapPmUrlToEnv(override, pmEnv);
}

export const PM_API_ENV = resolvePmApiEnv();
export const PM_USERS_HOST = PM_USERS_HOST_BY_ENV[PM_API_ENV];
export const PM_PAYMENT_HOST = PM_PAYMENT_HOST_BY_ENV[PM_API_ENV];

const isDevProxy =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const PM_AUTH_BASE_URL = isDevProxy
  ? '/pm-users'
  : resolvePmBaseUrl(import.meta.env.VITE_PM_AUTH_BASE_URL, PM_USERS_HOST, PM_API_ENV);

export const PM_PAYMENT_BASE_URL = isDevProxy
  ? '/pm-payment-initiate'
  : resolvePmBaseUrl(import.meta.env.VITE_PM_PAYMENT_BASE_URL, PM_PAYMENT_HOST, PM_API_ENV);

export const PM_PAYMENT_COMPLETE_BASE_URL = isDevProxy
  ? '/pm-payment-complete'
  : resolvePmBaseUrl(
      import.meta.env.VITE_PM_PAYMENT_COMPLETE_BASE_URL || import.meta.env.VITE_PM_PAYMENT_BASE_URL,
      PM_PAYMENT_HOST,
      PM_API_ENV
    );

export const PM_VAULT_OFFLINE_BASE_URL = isDevProxy
  ? '/pm-users'
  : resolvePmBaseUrl(
      import.meta.env.VITE_PM_VAULT_OFFLINE_BASE_URL || import.meta.env.VITE_PM_AUTH_BASE_URL,
      PM_USERS_HOST,
      PM_API_ENV
    );

const activePmApis = buildPmApiCatalog(
  PM_AUTH_BASE_URL,
  PM_PAYMENT_BASE_URL,
  PM_PAYMENT_COMPLETE_BASE_URL
);

export const PM_SEND_OTP_URL = activePmApis.sendOtp;
export const PM_VERIFY_OTP_URL = activePmApis.verifyOtp;
export const PM_REFRESH_URL = activePmApis.refresh;
export const PM_VENDOR_LEADS_URL = activePmApis.vendorLeads;
export const PM_VERIFY_GST_URL = activePmApis.verifyGst;
export const PM_USERS_URL = activePmApis.users;
export const PM_USERS_ME_URL = activePmApis.usersMe;
export const PM_ADDRESS_URL = activePmApis.address;
export const PM_STATE_BY_PINCODE_URL = activePmApis.stateByPincode;
export const PM_VAULT_URL = activePmApis.vault;
export const PM_VAULT_TRANSACTIONS_URL = activePmApis.vaultTransactions;
export const PM_VAULT_TOPUP_INITIATE_URL = activePmApis.vaultTopupInitiate;
export const PM_VAULT_TOPUP_COMPLETE_URL = activePmApis.vaultTopupComplete;
/** Backend-proxied order debit — always the env payment host, not the Vite proxy. */
export const PM_VAULT_PAY_ORDER_URL = PM_API_CATALOG[PM_API_ENV].vaultPayOrder;
export const PM_VAULT_ADD_MONEY_URL =
  PM_VAULT_OFFLINE_BASE_URL === PM_AUTH_BASE_URL
    ? activePmApis.vaultAddMoney
    : `${normalizeUrl(PM_VAULT_OFFLINE_BASE_URL)}/api/vault/add-money`;

export const PM_VENDOR_LEAD_VENDOR_FLAG = 'supplier';
/** Platform tenant flag — sent on all PM vault/payment APIs for DB filtering. */
export const PM_PLATFORM_FLAG = 'tatvadirect';
export const PM_VENDOR_LEAD_FLAG = PM_PLATFORM_FLAG;

const FOREIGN_PM_PLATFORM_FLAGS = new Set(['tatvavision', 'tatvaops']);

function platformFlagKey(flag) {
  return String(flag || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function isForeignPmPlatformFlag(flag) {
  return FOREIGN_PM_PLATFORM_FLAGS.has(platformFlagKey(flag));
}

export function normalizePmStoredUserFlag(flag, fallback = PM_PLATFORM_FLAG) {
  const raw = String(flag || '').trim();
  if (!raw || isForeignPmPlatformFlag(raw)) {
    return String(fallback || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  }
  return raw;
}

export function resolvePmDisplayPlatformFlag() {
  return String(PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
}

export function withPmPlatformFlagQuery(url, flag = PM_PLATFORM_FLAG) {
  const base = String(url || '').trim();
  const resolved = String(flag || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  if (!base) return base;
  try {
    const parsed = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    parsed.searchParams.set('flag', resolved);
    if (base.startsWith('/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    const withoutFlag = base.replace(/([?&])flag=[^&]*/gi, '$1').replace(/[?&]$/, '');
    return `${withoutFlag}${withoutFlag.includes('?') ? '&' : '?'}flag=${encodeURIComponent(resolved)}`;
  }
}

export function withPmPlatformFlagBody(body = {}, flag = PM_PLATFORM_FLAG) {
  const resolved = String(flag || PM_PLATFORM_FLAG || 'tatvadirect').trim() || 'tatvadirect';
  return {
    ...(body && typeof body === 'object' ? body : {}),
    flag: resolved,
    platformFlag: resolved
  };
}

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

export const PM_SAMPLE_PHONE = String(
  import.meta.env.VITE_PM_SAMPLE_PHONE || ''
).replace(/\D/g, '');

export const PM_AUTH_SESSION_KEY = 'pmAuthSession';
