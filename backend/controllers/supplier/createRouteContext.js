import multer from 'multer';
import { supabase } from '../../config/supabase.js';
import {
  upsertModelSpecProfile as upsertModelSpecProfileBase,
  enrichProductSpecificationsForDisplay as enrichProductSpecificationsForDisplayBase,
  resolveAdminSpecificationTemplate as resolveAdminSpecificationTemplateBase,
  loadSpecTemplateForCategory as loadSpecTemplateForCategoryBase
} from './specificationHelpers.js';
import {
  ORDER_INSERT_MAX_RETRIES,
  sanitizeImageUrls,
  resolveVariantTsin,
  normalizeUserAddress,
  validateAndNormalizeTaxRates,
  createTaxRateHelpers,
  isOrderNumberConflictError,
  isRevenueRecognizedOrder
} from './shared/productHelpers.js';

/**
 * Runtime context passed into each registerSupplier*Routes(router, ctx).
 */
export function createSupplierRouteContext(router, authenticateToken) {
  const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  const taxHelpers = createTaxRateHelpers(supabase);

  return {
    router,
    authenticateToken,
    supabase,
    productImageUpload,
    ORDER_INSERT_MAX_RETRIES,
    sanitizeImageUrls,
    resolveVariantTsin,
    normalizeUserAddress,
    validateAndNormalizeTaxRates,
    isOrderNumberConflictError,
    isRevenueRecognizedOrder,
    ...taxHelpers,
    upsertModelSpecProfile: (params) => upsertModelSpecProfileBase(supabase, params),
    enrichProductSpecificationsForDisplay: (params) =>
      enrichProductSpecificationsForDisplayBase(supabase, params),
    resolveAdminSpecificationTemplate: (params) =>
      resolveAdminSpecificationTemplateBase(supabase, params),
    loadSpecTemplateForCategory: (category, familyId) =>
      loadSpecTemplateForCategoryBase(supabase, category, familyId)
  };
}
