// API Base URL - automatically detects local development vs production
// Priority: 1. Environment variable, 2. Local development (localhost), 3. Production URL
const envApiUrl = import.meta.env.VITE_API_BASE_URL;
const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
const isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || 
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '');

// Determine API URL
let apiBaseUrl;
if (envApiUrl && envApiUrl.trim() !== '') {
  // Use environment variable if set
  apiBaseUrl = envApiUrl.trim().replace(/\/$/, '');
} else if (isDevelopment || isLocalhost) {
  // Use localhost for local development
  const backendPort = import.meta.env.VITE_BACKEND_PORT || '8081';
  apiBaseUrl = `http://localhost:${backendPort}`;
} else {
  // Fallback to production URL
  apiBaseUrl = 'https://tatvadirect.onrender.com';
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
