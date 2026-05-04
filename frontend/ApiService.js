import api, { endpoints } from '../config/api';

// ==================== AUTH SERVICES ====================
export const authService = {
  login: async (credentials) => {
    const response = await api.post(endpoints.auth.login, credentials);
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  register: async (userData) => {
    const response = await api.post(endpoints.auth.register, userData);
    return response.data;
  },

  verify: async () => {
    const response = await api.get(endpoints.auth.verify);
    return response.data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getCurrentUser: () => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  isAuthenticated: () => {
    return !!localStorage.getItem('token');
  },
};

// ==================== PROFILE SERVICES ====================
export const profileService = {
  getProfile: async () => {
    const response = await api.get(endpoints.profile.get);
    return response.data;
  },

  updateProfile: async (profileData) => {
    const response = await api.put(endpoints.profile.update, profileData);
    return response.data;
  },
};

// ==================== BOQ SERVICES ====================
export const boqService = {
  getAll: async (params = {}) => {
    const response = await api.get(endpoints.boq.list, { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(endpoints.boq.get(id));
    return response.data;
  },

  create: async (boqData) => {
    const response = await api.post(endpoints.boq.create, boqData);
    return response.data;
  },

  update: async (id, boqData) => {
    const response = await api.put(endpoints.boq.update(id), boqData);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(endpoints.boq.delete(id));
    return response.data;
  },

  uploadFile: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post(endpoints.boq.upload, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};

// ==================== VENDOR SERVICES ====================
export const vendorService = {
  getAll: async (params = {}) => {
    const response = await api.get(endpoints.vendors.list, { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(endpoints.vendors.get(id));
    return response.data;
  },

  create: async (vendorData) => {
    const response = await api.post(endpoints.vendors.create, vendorData);
    return response.data;
  },

  update: async (id, vendorData) => {
    const response = await api.put(endpoints.vendors.update(id), vendorData);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(endpoints.vendors.delete(id));
    return response.data;
  },
};

// ==================== SUBSTITUTION SERVICES ====================
export const substitutionService = {
  getAll: async (params = {}) => {
    const response = await api.get(endpoints.substitutions.list, { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(endpoints.substitutions.get(id));
    return response.data;
  },

  create: async (substitutionData) => {
    const response = await api.post(endpoints.substitutions.create, substitutionData);
    return response.data;
  },

  approve: async (id, approvalData) => {
    const response = await api.put(endpoints.substitutions.approve(id), approvalData);
    return response.data;
  },

  reject: async (id, rejectionData) => {
    const response = await api.put(endpoints.substitutions.reject(id), rejectionData);
    return response.data;
  },
};

// ==================== PURCHASE ORDER SERVICES ====================
export const poService = {
  getAll: async (params = {}) => {
    const response = await api.get(endpoints.po.list, { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(endpoints.po.get(id));
    return response.data;
  },

  create: async (poData) => {
    const response = await api.post(endpoints.po.create, poData);
    return response.data;
  },

  update: async (id, poData) => {
    const response = await api.put(endpoints.po.update(id), poData);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(endpoints.po.delete(id));
    return response.data;
  },
};

// ==================== SUPPLIER SERVICES ====================
export const supplierService = {
  getAll: async (params = {}) => {
    const response = await api.get(endpoints.supplier.list, { params });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(endpoints.supplier.get(id));
    return response.data;
  },

  create: async (supplierData) => {
    const response = await api.post(endpoints.supplier.create, supplierData);
    return response.data;
  },

  update: async (id, supplierData) => {
    const response = await api.put(endpoints.supplier.update(id), supplierData);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(endpoints.supplier.delete(id));
    return response.data;
  },
};

// ==================== DASHBOARD SERVICES ====================
export const dashboardService = {
  getStats: async () => {
    const response = await api.get(endpoints.dashboard.stats);
    return response.data;
  },

  getRecent: async () => {
    const response = await api.get(endpoints.dashboard.recent);
    return response.data;
  },
};

// ==================== ADMIN SERVICES ====================
export const adminService = {
  getUsers: async (params = {}) => {
    const response = await api.get(endpoints.admin.users, { params });
    return response.data;
  },

  getStatistics: async () => {
    const response = await api.get(endpoints.admin.statistics);
    return response.data;
  },
};

// ==================== HEALTH CHECK SERVICE ====================
export const healthService = {
  check: async () => {
    const response = await api.get(endpoints.health);
    return response.data;
  },
};

// Export all services
export default {
  auth: authService,
  profile: profileService,
  boq: boqService,
  vendor: vendorService,
  substitution: substitutionService,
  po: poService,
  supplier: supplierService,
  dashboard: dashboardService,
  admin: adminService,
  health: healthService,
};