/**
 * Database Service Layer
 * Provides helper functions for common database operations with Supabase
 */

import { supabase } from '../config/supabase.js';

/**
 * Check if an error is a transient network/SSL error that should be retried
 */
const isTransientError = (error) => {
  if (!error) return false;
  
  const errorMessage = error.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();
  
  // Check for SSL handshake errors (Cloudflare 525)
  if (errorMessage.includes('ssl handshake') || 
      errorMessage.includes('525') ||
      errorString.includes('ssl handshake') ||
      errorString.includes('525')) {
    return true;
  }
  
  // Check for network errors
  if (errorMessage.includes('network') || 
      errorMessage.includes('econnreset') ||
      errorMessage.includes('etimedout') ||
      errorMessage.includes('enotfound')) {
    return true;
  }
  
  // Check for Cloudflare errors
  if (errorMessage.includes('cloudflare') || errorString.includes('cloudflare')) {
    return true;
  }
  
  return false;
};

/**
 * Retry a Supabase query with exponential backoff
 * @param {Function} queryFn - Function that returns a Supabase query promise
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @returns {Promise} The query result
 */
export const retrySupabaseQuery = async (queryFn, options = {}) => {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await queryFn();
      
      // If there's an error in the result, check if it's transient
      if (result.error) {
        if (isTransientError(result.error) && attempt < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
          console.warn(`[Retry ${attempt + 1}/${maxRetries}] Transient error detected, retrying in ${delay}ms:`, result.error.message?.substring(0, 100));
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = result.error;
          continue;
        }
        // Non-transient error or max retries reached
        return result;
      }
      
      // Success
      return result;
    } catch (error) {
      lastError = error;
      
      if (isTransientError(error) && attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
        console.warn(`[Retry ${attempt + 1}/${maxRetries}] Transient error detected, retrying in ${delay}ms:`, error.message?.substring(0, 100));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-transient error or max retries reached
      throw error;
    }
  }
  
  // All retries exhausted
  throw lastError || new Error('Query failed after retries');
};

/**
 * Helper to handle Supabase errors and extract data
 */
export const handleSupabaseResponse = (response, errorMessage = 'Database operation failed') => {
  if (response.error) {
    const error = new Error(response.error.message || errorMessage);
    error.code = response.error.code;
    error.details = response.error.details;
    throw error;
  }
  return response.data;
};

/**
 * Helper to build query filters
 */
export const buildFilters = (query, filters = {}) => {
  if (!query) return query;
  
  // Handle common filter patterns
  Object.keys(filters).forEach(key => {
    const value = filters[key];
    
    if (value === undefined || value === null) return;
    
    if (Array.isArray(value)) {
      query = query.in(key, value);
    } else if (typeof value === 'object' && value.operator) {
      // Handle operators like { operator: 'gte', value: 100 }
      switch (value.operator) {
        case 'gte':
          query = query.gte(key, value.value);
          break;
        case 'lte':
          query = query.lte(key, value.value);
          break;
        case 'gt':
          query = query.gt(key, value.value);
          break;
        case 'lt':
          query = query.lt(key, value.value);
          break;
        case 'like':
          query = query.like(key, `%${value.value}%`);
          break;
        case 'ilike':
          query = query.ilike(key, `%${value.value}%`);
          break;
        default:
          query = query.eq(key, value.value);
      }
    } else {
      query = query.eq(key, value);
    }
  });
  
  return query;
};

/**
 * Pagination helper
 */
export const paginate = (query, page = 1, limit = 10) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return query.range(from, to);
};

/**
 * Text search helper (using PostgreSQL full-text search)
 */
export const textSearch = (query, searchTerm, columns = []) => {
  if (!searchTerm) return query;
  
  // For simple text search, use ilike on multiple columns
  // For advanced full-text search, you'd use to_tsvector
  const searchPattern = `%${searchTerm}%`;
  const conditions = columns.map(col => `${col}.ilike.${searchPattern}`).join(',');
  
  // This is a simplified version - you might want to use PostgreSQL's full-text search
  return query.or(columns.map(col => `${col}.ilike.${searchPattern}`).join(','));
};

/**
 * Get single record by ID
 */
export const findById = async (table, id, select = '*') => {
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('id', id)
    .single();
  
  return handleSupabaseResponse({ data, error }, `Failed to find ${table} with id ${id}`);
};

/**
 * Find records with filters
 */
export const find = async (table, filters = {}, options = {}) => {
  let query = supabase.from(table).select(options.select || '*');
  
  // Apply filters
  query = buildFilters(query, filters);
  
  // Apply sorting
  if (options.sort) {
    const { field, order = 'asc' } = options.sort;
    query = query.order(field, { ascending: order === 'asc' });
  }
  
  // Apply pagination
  if (options.page && options.limit) {
    query = paginate(query, options.page, options.limit);
  } else if (options.limit) {
    query = query.limit(options.limit);
  }
  
  const { data, error } = await query;
  return handleSupabaseResponse({ data, error }, `Failed to find ${table}`);
};

/**
 * Create a new record
 */
export const create = async (table, data) => {
  const { data: result, error } = await supabase
    .from(table)
    .insert(data)
    .select()
    .single();
  
  return handleSupabaseResponse({ data: result, error }, `Failed to create ${table}`);
};

/**
 * Update a record
 */
export const update = async (table, id, data) => {
  const { data: result, error } = await supabase
    .from(table)
    .update(data)
    .eq('id', id)
    .select()
    .single();
  
  return handleSupabaseResponse({ data: result, error }, `Failed to update ${table} with id ${id}`);
};

/**
 * Delete a record
 */
export const remove = async (table, id) => {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq('id', id)
    .select()
    .single();
  
  return handleSupabaseResponse({ data, error }, `Failed to delete ${table} with id ${id}`);
};

/**
 * Count records
 */
export const count = async (table, filters = {}) => {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  query = buildFilters(query, filters);
  
  const { count, error } = await query;
  return handleSupabaseResponse({ data: count, error }, `Failed to count ${table}`);
};

export default {
  findById,
  find,
  create,
  update,
  remove,
  count,
  handleSupabaseResponse,
  buildFilters,
  paginate,
  textSearch
};
