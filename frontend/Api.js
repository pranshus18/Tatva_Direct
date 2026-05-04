import axios from 'axios';

// API Base URL - uses environment variable in production, falls back to hardcoded URL
// In Vercel, set VITE_API_BASE_URL environment variable to your Render backend URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://tatvadirect.onrender.com';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add auth token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle errors globally
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          // Unauthorized - clear token and redirect to login
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/login';
          break;
        case 403:
          console.error('Access forbidden:', data.message);
          break;
        case 404:
          console.error('Resource not found:', data.message);
          break;
        case 500:
          console.error('Server error:', data.message);
          break;
        default:
          console.error('API Error:', data.message);
      }
    } else if (error.request) {
      // Request made but no response
      console.error('No response from server. Please check your connection.');
    } else {
      // Something else happened
      console.error('Error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// API endpoints
export const endpoints = {
  // Auth endpoints
  auth: {
    login: '/api/auth/login',
    register: '/api/auth/register',
    verify: '/api/auth/verify',
    refreshToken: '/api/auth/refresh-token',
  },
  
  // Profile endpoints
  profile: {
    get: '/api/profile',
    update: '/api/profile',
  },
  
  // Admin endpoints
  admin: {
    users: '/api/admin/users',
    statistics: '/api/admin/statistics',
  },
  
  // Dashboard endpoints
  dashboard: {
    stats: '/api/dashboard/stats',
    recent: '/api/dashboard/recent',
  },
  
  // BOQ endpoints
  boq: {
    list: '/api/boq',
    create: '/api/boq',
    get: (id) => `/api/boq/${id}`,
    update: (id) => `/api/boq/${id}`,
    delete: (id) => `/api/boq/${id}`,
    upload: '/api/boq/upload',
  },
  
  // Vendor endpoints
  vendors: {
    list: '/api/vendors',
    create: '/api/vendors',
    get: (id) => `/api/vendors/${id}`,
    update: (id) => `/api/vendors/${id}`,
    delete: (id) => `/api/vendors/${id}`,
  },
  
  // Substitution endpoints
  substitutions: {
    list: '/api/substitutions',
    create: '/api/substitutions',
    get: (id) => `/api/substitutions/${id}`,
    approve: (id) => `/api/substitutions/${id}/approve`,
    reject: (id) => `/api/substitutions/${id}/reject`,
  },
  
  // Purchase Order endpoints
  po: {
    list: '/api/po',
    create: '/api/po',
    get: (id) => `/api/po/${id}`,
    update: (id) => `/api/po/${id}`,
    delete: (id) => `/api/po/${id}`,
  },
  
  // Supplier endpoints
  supplier: {
    list: '/api/supplier',
    create: '/api/supplier',
    get: (id) => `/api/supplier/${id}`,
    update: (id) => `/api/supplier/${id}`,
    delete: (id) => `/api/supplier/${id}`,
  },
  
  // Health check
  health: '/api/health',
};

export { api, API_BASE_URL };
export default api;