import { AsyncLocalStorage } from 'node:async_hooks';

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const pmRequestEnv = new AsyncLocalStorage();

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

/**
 * Every PM path used by Tatva. Same on devopsapi (dev) and opsapi (prod).
 */
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
 * Resolve PM environment.
 * 1. Tatva frontend hostname/origin (dev site vs prod site)
 * 2. Explicit PM_API_ENV=dev | production
 * 3. NODE_ENV=production → opsapi
 */
export function resolvePmApiEnv(
  raw = process.env.PM_API_ENV,
  nodeEnv = process.env.NODE_ENV,
  hostname = ''
) {
  const fromHost = pmEnvFromTatvaHostname(hostname);
  if (fromHost) return fromHost;
  const explicit = String(raw || '').trim().toLowerCase();
  if (explicit === 'production' || explicit === 'prod') return 'production';
  if (explicit === 'dev' || explicit === 'development') return 'development';
  const node = String(nodeEnv || '').trim().toLowerCase();
  if (node === 'production' || node === 'prod') return 'production';
  return 'development';
}

export function resolvePmApiEnvFromRequest(req) {
  const origin = req?.headers?.origin || '';
  const referer = req?.headers?.referer || '';
  return resolvePmApiEnv(process.env.PM_API_ENV, process.env.NODE_ENV, origin || referer);
}

export function runWithPmRequestEnv(env, callback) {
  return pmRequestEnv.run(env === 'production' ? 'production' : 'development', callback);
}

export function getRequestPmEnv() {
  return pmRequestEnv.getStore() || PM_API_ENV;
}

export function getResolvedCatalog(pmEnv = getRequestPmEnv()) {
  const env = pmEnv === 'production' ? 'production' : 'development';
  const base = PM_API_CATALOG[env];
  const users = resolvePmBaseUrl(process.env.PM_API_BASE_URL, base.usersBase, env);
  const payment = resolvePmBaseUrl(process.env.PM_PAYMENT_API_BASE_URL, base.paymentBase, env);
  const paymentComplete = resolvePmBaseUrl(
    process.env.PM_PAYMENT_COMPLETE_API_BASE_URL,
    payment,
    env
  );
  return buildPmApiCatalog(users, payment, paymentComplete);
}

/** Live PM URL for the current request (dev frontend → devopsapi, prod frontend → opsapi). */
export function pmUrl(key) {
  const catalog = getResolvedCatalog();
  if (key === 'usersBase') return catalog.usersBase;
  if (key === 'paymentBase') return catalog.paymentBase;
  if (key === 'vaultAddMoney') {
    const offline = resolvePmBaseUrl(
      process.env.PM_VAULT_OFFLINE_API_BASE_URL,
      catalog.usersBase,
      getRequestPmEnv()
    );
    return `${offline}/api/vault/add-money`;
  }
  if (key === 'vaultPayOrder') {
    const raw = resolvePmBaseUrl(
      process.env.PM_VAULT_PAY_ORDER_URL,
      catalog.vaultPayOrder,
      getRequestPmEnv()
    );
    return /\/api\/vault\/debit\/?$/i.test(raw) ? catalog.vaultPayOrder : raw;
  }
  return catalog[key];
}

/** Rewrite a PM URL onto the host that matches pmEnv (devopsapi vs opsapi). */
export function remapPmUrlToEnv(url, pmEnv) {
  const value = normalizeUrl(url);
  if (!value) return value;
  const targetHost = pmEnv === 'production' ? PM_PROD_HOST : PM_DEV_HOST;
  const otherHost = pmEnv === 'production' ? PM_DEV_HOST : PM_PROD_HOST;
  if (!value.includes(otherHost)) return value;
  return value.split(otherHost).join(targetHost);
}

/**
 * Prefer catalog host for the active env. Env URL overrides are kept only when
 * they already match that env; leftover devopsapi URLs on production are remapped.
 */
export function resolvePmBaseUrl(envValue, catalogValue, pmEnv) {
  const catalog = normalizeUrl(catalogValue);
  const override = normalizeUrl(envValue);
  if (!override) return catalog;
  const remapped = remapPmUrlToEnv(override, pmEnv);
  if (remapped !== override) {
    console.warn(`[PM API] Remapping stale ${override} → ${remapped} (${pmEnv})`);
  }
  return remapped;
}

export const PM_API_ENV = resolvePmApiEnv();
const catalogHosts = PM_API_CATALOG[PM_API_ENV];

export const PM_API_BASE_URL = resolvePmBaseUrl(
  process.env.PM_API_BASE_URL,
  catalogHosts.usersBase,
  PM_API_ENV
);

export const PM_PAYMENT_API_BASE_URL = resolvePmBaseUrl(
  process.env.PM_PAYMENT_API_BASE_URL,
  catalogHosts.paymentBase,
  PM_API_ENV
);

export const PM_PAYMENT_COMPLETE_API_BASE_URL = resolvePmBaseUrl(
  process.env.PM_PAYMENT_COMPLETE_API_BASE_URL,
  PM_PAYMENT_API_BASE_URL,
  PM_API_ENV
);

export const PM_VAULT_OFFLINE_API_BASE_URL = resolvePmBaseUrl(
  process.env.PM_VAULT_OFFLINE_API_BASE_URL,
  PM_API_BASE_URL,
  PM_API_ENV
);

/** Active PM paths after env + leftover URL remapping. */
const activePmApis = buildPmApiCatalog(
  PM_API_BASE_URL,
  PM_PAYMENT_API_BASE_URL,
  PM_PAYMENT_COMPLETE_API_BASE_URL
);

export const PM_VENDOR_LEADS_URL = activePmApis.vendorLeads;
export const PM_VERIFY_GST_URL = activePmApis.verifyGst;
export const PM_USERS_URL = activePmApis.users;
export const PM_USERS_ME_URL = activePmApis.usersMe;
export const PM_SEND_OTP_URL = activePmApis.sendOtp;
export const PM_VERIFY_OTP_URL = activePmApis.verifyOtp;
export const PM_ADDRESS_URL = activePmApis.address;
export const PM_STATE_BY_PINCODE_URL = activePmApis.stateByPincode;
export const PM_VAULT_URL = activePmApis.vault;
export const PM_VAULT_TRANSACTIONS_URL = activePmApis.vaultTransactions;
export const PM_VAULT_TOPUP_INITIATE_URL = activePmApis.vaultTopupInitiate;
export const PM_VAULT_TOPUP_COMPLETE_URL = activePmApis.vaultTopupComplete;
export const PM_VAULT_ADD_MONEY_FALLBACK_URL = activePmApis.vaultAddMoney;
export const PM_VAULT_ADD_MONEY_URL =
  PM_VAULT_OFFLINE_API_BASE_URL === PM_API_BASE_URL
    ? activePmApis.vaultAddMoney
    : `${PM_VAULT_OFFLINE_API_BASE_URL}/api/vault/add-money`;

const rawPmVaultPayOrderUrl = resolvePmBaseUrl(
  process.env.PM_VAULT_PAY_ORDER_URL,
  activePmApis.vaultPayOrder,
  PM_API_ENV
);
export const PM_VAULT_PAY_ORDER_URL = /\/api\/vault\/debit\/?$/i.test(rawPmVaultPayOrderUrl)
  ? activePmApis.vaultPayOrder
  : rawPmVaultPayOrderUrl;

export function getActivePmApiSnapshot() {
  const env = getRequestPmEnv();
  const catalog = getResolvedCatalog(env);
  return {
    env,
    defaultEnv: PM_API_ENV,
    usersHost: catalog.usersBase,
    paymentHost: catalog.paymentBase,
    tatvaFrontends: {
      'https://direct.withtatva.ai': 'production → opsapi',
      'https://tatva-direct-frontend-five.vercel.app': 'development → devopsapi',
      localhost: 'development → devopsapi'
    },
    endpoints: {
      sendOtp: catalog.sendOtp,
      verifyOtp: catalog.verifyOtp,
      verifyGst: catalog.verifyGst,
      vendorLeads: catalog.vendorLeads,
      users: catalog.users,
      usersMe: catalog.usersMe,
      address: catalog.address,
      stateByPincode: catalog.stateByPincode,
      vault: catalog.vault,
      vaultTransactions: catalog.vaultTransactions,
      vaultAddMoney: pmUrl('vaultAddMoney'),
      vaultTopupInitiate: catalog.vaultTopupInitiate,
      vaultTopupComplete: catalog.vaultTopupComplete,
      vaultPayOrder: pmUrl('vaultPayOrder')
    }
  };
}

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

export const PM_USER_FLAG_SERVICE_PROVIDER = 'service_provider';
export const PM_USER_FLAG_SUPPLIER = 'supplier';

export function buildPmUserUrl(pmUserId) {
  const id = String(pmUserId || '').trim();
  if (!id) return null;
  return `${pmUrl('usersBase')}/api/users/${id}`;
}
