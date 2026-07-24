// API Base URL - automatically detects local development vs production.
import { getPmCustomerCredentials } from '../utils/pmAuthSession';
// Priority: 1. Valid environment variable, 2. Local development (localhost), 3. Production URL fallback.
// Canonical Render service for this repo is tatva-direct (hyphen). The older tatvadirect host
// is missing newer routes such as POST /api/po/transport/confirm.
const DEFAULT_PRODUCTION_API_URL = 'https://tatva-direct.onrender.com';
const STALE_PRODUCTION_API_HOSTS = new Set(['https://tatvadirect.onrender.com']);
const envApiUrl = import.meta.env.VITE_API_BASE_URL;
const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
const isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '');

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const isLocalApiUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizeUrl(url));

// Determine API URL
let apiBaseUrl;
if (envApiUrl && envApiUrl.trim() !== '') {
  // Prevent broken production deploys when env var is set to localhost.
  const normalizedEnvApiUrl = normalizeUrl(envApiUrl);
  if (!isLocalhost && isLocalApiUrl(normalizedEnvApiUrl)) {
    apiBaseUrl = DEFAULT_PRODUCTION_API_URL;
    console.warn(
      '[API] Ignoring localhost VITE_API_BASE_URL in production. Falling back to',
      DEFAULT_PRODUCTION_API_URL
    );
  } else if (STALE_PRODUCTION_API_HOSTS.has(normalizedEnvApiUrl)) {
    // Older Render hostname is missing routes such as POST /api/po/transport/confirm.
    apiBaseUrl = DEFAULT_PRODUCTION_API_URL;
    console.warn(
      '[API] Remapping stale VITE_API_BASE_URL host to',
      DEFAULT_PRODUCTION_API_URL
    );
  } else {
    apiBaseUrl = normalizedEnvApiUrl;
  }
} else if (isDevelopment || isLocalhost) {
  // Use localhost for local development
  const backendPort = import.meta.env.VITE_BACKEND_PORT || '8081';
  apiBaseUrl = `http://localhost:${backendPort}`;
} else {
  // Fallback to production URL
  apiBaseUrl = DEFAULT_PRODUCTION_API_URL;
}

export const API_BASE_URL = apiBaseUrl;

// Log for debugging
if (isDevelopment) {
  console.log('🔧 API Configuration:', {
    mode: import.meta.env.MODE,
    isDevelopment,
    isLocalhost,
    hostname: typeof window !== 'undefined' ? window.location.hostname : 'N/A',
    envVar: import.meta.env.VITE_API_BASE_URL,
    backendPort: import.meta.env.VITE_BACKEND_PORT || '8081',
    finalUrl: API_BASE_URL
  });
}

// Helper function to create full API URL
export const getApiUrl = (endpoint) => {
  // Remove leading slash if present to avoid double slashes
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
};

/**
 * URL for browser fetch():
 * - In local Vite dev on localhost/127.0.0.1, prefer same-origin `/api/...` so the Vite proxy
 *   forwards to the local backend consistently.
 * - Otherwise, use the absolute URL from `getApiUrl`.
 */
export const resolveApiPath = (endpoint) => {
  const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const useViteProxy =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (useViteProxy) return clean;
  return getApiUrl(endpoint);
};

/** Attach PM platform tokens so every customer uses their own shared vault session. */
export function withPmAuthHeaders(headers = {}) {
  const { accessToken, refreshToken } = getPmCustomerCredentials();
  return {
    ...headers,
    ...(accessToken ? { 'X-PM-Access-Token': accessToken } : {}),
    ...(refreshToken ? { 'X-PM-Refresh-Token': refreshToken } : {})
  };
}

export function buildAuthHeaders(extra = {}) {
  const token = localStorage.getItem('token');
  return withPmAuthHeaders({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  });
}

// Helper function for fetch calls with authentication
export const apiFetch = async (endpoint, options = {}) => {
  const url = getApiUrl(endpoint);
  
  const headers = buildAuthHeaders({
    'Content-Type': 'application/json',
    ...(options.headers || {})
  });

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw { status: response.status, ...errorData };
  }

  return response.json();
};

/**
 * Auth-aware fetch for portal pages:
 * - Adds bearer token automatically.
 * - Applies a timeout so loaders don't spin forever on stuck requests.
 * - Forces relogin on 401 (expired/invalid session) only.
 *   403 is role/permission denial and must not clear the session — otherwise
 *   in-flight calls during portal switch kick the user back to OTP login.
 */
export const authFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const timeoutMs = Number(options.timeoutMs || 15000);
  const externalSignal = options.signal;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = externalSignal || controller.signal;

  const headers = buildAuthHeaders(options.headers || {});

  const targetUrl = /^https?:\/\//i.test(String(endpoint || ''))
    ? String(endpoint)
    : resolveApiPath(endpoint);

  try {
    const response = await fetch(targetUrl, {
      ...options,
      headers,
      signal
    });

    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      try {
        localStorage.removeItem('profilePhotoUrl');
        localStorage.removeItem('profilePhotoUserId');
      } catch {
        // ignore storage errors
      }
      if (typeof window !== 'undefined') {
        window.location.replace('/pm-auth');
      }
      const authError = new Error('Session expired. Please log in again.');
      authError.status = response.status;
      throw authError;
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
};
