import { PM_AUTH_SESSION_KEY } from '../config/pmAuth';

const PM_ACCESS_TOKEN_KEY = 'pmCustomerAccessToken';
const PM_REFRESH_TOKEN_KEY = 'pmCustomerRefreshToken';
const PM_USER_ID_KEY = 'pmCustomerUserId';

function readStorageItem(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || null;
}

function writeStorageItem(key, value) {
  localStorage.setItem(key, String(value));
  sessionStorage.setItem(key, String(value));
}

function removeStorageItem(key) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

export function getPmAuthSession() {
  try {
    const raw = localStorage.getItem(PM_AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.verified || !parsed?.phoneNumber) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isPmAuthenticated() {
  return Boolean(getPmAuthSession());
}

export function setPmAuthSession({ phoneNumber, data = null }) {
  const session = {
    phoneNumber: String(phoneNumber || '').replace(/\D/g, ''),
    verified: true,
    verifiedAt: new Date().toISOString(),
    data
  };
  localStorage.setItem(PM_AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

/** Clears transient OTP session only — keeps PM vault credentials for API calls. */
export function clearPmOtpSession() {
  localStorage.removeItem(PM_AUTH_SESSION_KEY);
}

/** Clears OTP session and PM vault credentials (use on logout). */
export function clearPmAuthSession() {
  clearPmOtpSession();
  clearPmCustomerCredentials();
}

export function setPmCustomerCredentials({ accessToken = null, refreshToken = null, pmUserId = null } = {}) {
  if (accessToken) {
    writeStorageItem(PM_ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    writeStorageItem(PM_REFRESH_TOKEN_KEY, refreshToken);
  }
  if (pmUserId) {
    writeStorageItem(PM_USER_ID_KEY, pmUserId);
  }
}

export function applyPmVaultCredentials(pmVault) {
  if (!pmVault || typeof pmVault !== 'object') return getPmCustomerCredentials();
  setPmCustomerCredentials(pmVault);
  return getPmCustomerCredentials();
}

/** Persist rotated PM tokens returned on Tatva API responses. */
export function applyPmAuthFromResponse(response) {
  if (!response?.headers || typeof response.headers.get !== 'function') {
    return getPmCustomerCredentials();
  }
  const accessToken =
    response.headers.get('X-PM-Access-Token') || response.headers.get('x-pm-access-token');
  const refreshToken =
    response.headers.get('X-PM-Refresh-Token') || response.headers.get('x-pm-refresh-token');
  const pmUserId = response.headers.get('X-PM-User-Id') || response.headers.get('x-pm-user-id');
  if (accessToken || refreshToken || pmUserId) {
    setPmCustomerCredentials({ accessToken, refreshToken, pmUserId });
  }
  return getPmCustomerCredentials();
}

export function getPmCustomerCredentials() {
  return {
    accessToken: readStorageItem(PM_ACCESS_TOKEN_KEY),
    refreshToken: readStorageItem(PM_REFRESH_TOKEN_KEY),
    pmUserId: readStorageItem(PM_USER_ID_KEY)
  };
}

export function hasPmCustomerCredentials() {
  const { accessToken, pmUserId } = getPmCustomerCredentials();
  return Boolean(accessToken || pmUserId);
}

export function clearPmCustomerCredentials() {
  removeStorageItem(PM_ACCESS_TOKEN_KEY);
  removeStorageItem(PM_REFRESH_TOKEN_KEY);
  removeStorageItem(PM_USER_ID_KEY);
}

export function getVerifiedServiceProviderPhone(user = null, fallback = '') {
  const fromUser = String(user?.phone || '').replace(/\D/g, '').slice(-10);
  if (fromUser.length === 10) return fromUser;

  const pmSession = getPmAuthSession();
  const fromSession = String(pmSession?.phoneNumber || '').replace(/\D/g, '').slice(-10);
  if (fromSession.length === 10) return fromSession;

  return String(fallback || '').replace(/\D/g, '').slice(-10);
}
