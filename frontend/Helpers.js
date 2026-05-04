import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for API calls with loading, error, and data states
 * @param {Function} apiFunction - The API function to call
 * @param {boolean} callOnMount - Whether to call the API on component mount
 * @returns {Object} { data, loading, error, refetch, setData }
 */
export const useApi = (apiFunction, callOnMount = true) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(callOnMount);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'An error occurred';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiFunction]);

  useEffect(() => {
    if (callOnMount) {
      execute();
    }
  }, [callOnMount, execute]);

  return {
    data,
    loading,
    error,
    execute,
    refetch: execute,
    setData
  };
};

/**
 * Custom hook for paginated API calls
 * @param {Function} apiFunction - The API function to call
 * @param {number} initialPage - Initial page number
 * @param {number} pageSize - Items per page
 * @returns {Object} Pagination state and controls
 */
export const usePaginatedApi = (apiFunction, initialPage = 1, pageSize = 10) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const fetchData = useCallback(async (pageNum = page) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFunction({
        page: pageNum,
        limit: pageSize
      });
      setData(result.data || result);
      setTotalPages(result.totalPages || 0);
      setTotalItems(result.totalItems || result.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [apiFunction, page, pageSize]);

  useEffect(() => {
    fetchData(page);
  }, [page, fetchData]);

  const nextPage = () => {
    if (page < totalPages) {
      setPage(prev => prev + 1);
    }
  };

  const prevPage = () => {
    if (page > 1) {
      setPage(prev => prev - 1);
    }
  };

  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum);
    }
  };

  return {
    data,
    loading,
    error,
    page,
    totalPages,
    totalItems,
    nextPage,
    prevPage,
    goToPage,
    refetch: fetchData
  };
};

/**
 * Format error message from API response
 * @param {Error} error - Error object
 * @returns {string} Formatted error message
 */
export const getErrorMessage = (error) => {
  if (error.response) {
    // Server responded with error
    return error.response.data?.message || 
           error.response.data?.error || 
           `Error: ${error.response.status}`;
  } else if (error.request) {
    // Request made but no response
    return 'No response from server. Please check your connection.';
  } else {
    // Something else happened
    return error.message || 'An unexpected error occurred';
  }
};

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  }).format(amount);
};

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date string
 */
export const formatDate = (date, includeTime = false) => {
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime && {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
  return new Date(date).toLocaleDateString('en-IN', options);
};

/**
 * Debounce function for search inputs
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait = 300) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Download file from blob
 * @param {Blob} blob - File blob
 * @param {string} filename - File name
 */
export const downloadFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} Is valid email
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Indian format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} Is valid phone
 */
export const isValidPhone = (phone) => {
  const phoneRegex = /^[6-9]\d{9}$/;
  return phoneRegex.test(phone);
};

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Get status badge color
 * @param {string} status - Status value
 * @returns {string} Color class or hex
 */
export const getStatusColor = (status) => {
  const colors = {
    pending: '#FFA726',
    approved: '#66BB6A',
    rejected: '#EF5350',
    completed: '#42A5F5',
    active: '#66BB6A',
    inactive: '#9E9E9E',
    draft: '#BDBDBD'
  };
  return colors[status?.toLowerCase()] || '#9E9E9E';
};

/**
 * Calculate percentage
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @returns {number} Percentage
 */
export const calculatePercentage = (value, total) => {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
};

/**
 * Group array by key
 * @param {Array} array - Array to group
 * @param {string} key - Key to group by
 * @returns {Object} Grouped object
 */
export const groupBy = (array, key) => {
  return array.reduce((result, item) => {
    const groupKey = item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
};

/**
 * Sort array by key
 * @param {Array} array - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} order - 'asc' or 'desc'
 * @returns {Array} Sorted array
 */
export const sortBy = (array, key, order = 'asc') => {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
};

/**
 * Check if object is empty
 * @param {Object} obj - Object to check
 * @returns {boolean} Is empty
 */
export const isEmpty = (obj) => {
  return !obj || Object.keys(obj).length === 0;
};

/**
 * Deep clone object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
export const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Generate unique ID
 * @returns {string} Unique ID
 */
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export default {
  useApi,
  usePaginatedApi,
  getErrorMessage,
  formatCurrency,
  formatDate,
  debounce,
  downloadFile,
  isValidEmail,
  isValidPhone,
  truncateText,
  getStatusColor,
  calculatePercentage,
  groupBy,
  sortBy,
  isEmpty,
  deepClone,
  generateId
};