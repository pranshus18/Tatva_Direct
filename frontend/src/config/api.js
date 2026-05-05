// API Base URL - automatically detects local development vs production.
// Priority: 1. Valid environment variable, 2. Local development (localhost), 3. Production URL fallback.
const DEFAULT_PRODUCTION_API_URL = 'https://tatvadirect.onrender.com';
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

// Helper function for fetch calls with authentication
export const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const url = getApiUrl(endpoint);
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

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
