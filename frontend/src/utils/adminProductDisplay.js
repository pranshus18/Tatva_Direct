import {
  getAdminBuyerFacingCatalogDescription,
  getAdminSupplierSubmittedDescription
} from './productDisplay';
import {
  catalogSpecificationTemplateForVariantMerge,
  mergeCatalogAndOfferSpecificationsForDisplay,
  parseSpecificationsObject
} from './specifications';

/** Admin view: merge catalog template keys with supplier-filled offer values. */
export function resolveAdminDisplaySpecifications(product = {}) {
  if (product?.catalogSpecifications || product?.supplierOfferSpecifications) {
    const catalogTemplate = catalogSpecificationTemplateForVariantMerge(
      product.catalogSpecifications || {}
    );
    return mergeCatalogAndOfferSpecificationsForDisplay(
      catalogTemplate,
      product.supplierOfferSpecifications || {}
    );
  }
  return parseSpecificationsObject(product?.specifications) || {};
}

/** Text sent to Polish with AI: current buyer-facing edit box, then supplier draft. */
export function getAdminPolishSourceText({ product, editedProduct, isEditing }) {
  const typed = isEditing ? String(editedProduct?.description || '').trim() : '';
  if (typed) return typed;
  const supplierDraft = getAdminSupplierSubmittedDescription(product);
  if (supplierDraft) return supplierDraft;
  return getAdminBuyerFacingCatalogDescription(product);
}
