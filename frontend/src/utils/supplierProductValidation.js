import { parseSupplierStockQuantity } from './parseSupplierStockQuantity';
import { SUPPLIER_CURRENT_STOCK_LABEL, SUPPLIER_MRP_LABEL } from './supplierStockLabel';

export const MIN_SUPPLIER_PRODUCT_PHOTOS = 3;

/** Count only persisted http(s) image URLs (not local blob previews). */
export function countSupplierProductPhotos(images) {
  if (!Array.isArray(images)) return 0;
  const seen = new Set();
  let count = 0;
  for (const raw of images) {
    const url = String(raw || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    count += 1;
  }
  return count;
}

export function formatMissingProductPhotosMessage(photoCount = 0, minPhotos = MIN_SUPPLIER_PRODUCT_PHOTOS) {
  const count = Number(photoCount) || 0;
  const stillNeeded = Math.max(0, minPhotos - count);
  if (count <= 0) {
    return `At least ${minPhotos} product photos are required before submitting. Please upload ${minPhotos} photos (for example front, side, and label).`;
  }
  return `At least ${minPhotos} product photos are required. You currently have ${count}. Please upload ${stillNeeded} more photo${stillNeeded === 1 ? '' : 's'}.`;
}

/**
 * Mandatory fields for Manage Inventory (step 2) updates.
 * Returns human-readable labels for empty/invalid fields.
 */
export function getSupplierInventoryUpdateMissingFields(formData = {}) {
  const missing = [];

  const priceRaw = formData.price;
  const priceEmpty = priceRaw === '' || priceRaw === null || priceRaw === undefined;
  const priceNum = Number(priceRaw);
  if (priceEmpty || !Number.isFinite(priceNum) || priceNum < 0) {
    missing.push(SUPPLIER_MRP_LABEL);
  }

  if (parseSupplierStockQuantity(formData.stock) === null) {
    missing.push(SUPPLIER_CURRENT_STOCK_LABEL);
  }

  if (formData.sgst_rate === '' || formData.sgst_rate === null || formData.sgst_rate === undefined) {
    missing.push('SGST');
  }
  if (formData.cgst_rate === '' || formData.cgst_rate === null || formData.cgst_rate === undefined) {
    missing.push('CGST');
  }
  if (formData.igst_rate === '' || formData.igst_rate === null || formData.igst_rate === undefined) {
    missing.push('IGST');
  }

  return missing;
}

/**
 * Mandatory fields for Manage Products catalog create/update (step 1).
 */
export function getSupplierCatalogMandatoryMissingFields(formData = {}, options = {}) {
  const {
    requirePhotos = false,
    minPhotos = MIN_SUPPLIER_PRODUCT_PHOTOS,
    photoCount
  } = options;
  const missing = [];

  if (!String(formData.name || '').trim()) missing.push('Product name');
  if (!String(formData.brand || '').trim()) missing.push('Brand');
  if (!String(formData.category || '').trim()) missing.push('Category');

  const shouldRequireUnit =
    options.requireUnit === true ||
    (options.requireUnit !== false && options.isCreate === true);
  if (shouldRequireUnit && !String(formData.unit || '').trim()) {
    missing.push('Unit');
  }

  const resolvedPhotoCount =
    photoCount != null
      ? Number(photoCount) || 0
      : countSupplierProductPhotos(formData.images);

  if (requirePhotos && resolvedPhotoCount < minPhotos) {
    missing.push(`At least ${minPhotos} product photos`);
  }

  return missing;
}

export function formatSupplierProductValidationMessage(missingFields = []) {
  if (!Array.isArray(missingFields) || missingFields.length === 0) {
    return 'Please complete all required fields.';
  }
  const photoMissing = missingFields.find((field) =>
    /product photos/i.test(String(field || ''))
  );
  if (photoMissing && missingFields.length === 1) {
    return formatMissingProductPhotosMessage(0);
  }
  return `Please complete: ${missingFields.join(', ')}.`;
}

/** Prefer API structured validation errors when present. */
export function getSupplierProductUpdateErrorMessage(data) {
  if (!data || typeof data !== 'object') {
    return 'Failed to update product';
  }
  if (data.code === 'unit_incompatible' && data.message) {
    return String(data.message);
  }
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.filter(Boolean).join(' ');
  }
  if (data.message) return String(data.message);
  return 'Failed to update product';
}

export function getSupplierProductCreateErrorMessage(data) {
  if (!data || typeof data !== 'object') {
    return 'Failed to add product';
  }
  if (
    (data.code === 'product_photos_required' ||
      data.code === 'brand_approval_required' ||
      data.code === 'brand_approval_pending' ||
      data.code === 'brand_required' ||
      data.code === 'unit_incompatible') &&
    data.message
  ) {
    return String(data.message);
  }
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.filter(Boolean).join(' ');
  }
  if (data.message) return String(data.message);
  return 'Failed to add product';
}
