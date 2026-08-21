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

export function isMeaningfullyFilledSpecValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return String(value).trim() !== '';
}

/** Require every admin-defined specification key when a category template is loaded. */
export function getSupplierSpecificationTemplateMissingFields(
  specTemplateKeys = [],
  specifications = {}
) {
  if (!Array.isArray(specTemplateKeys) || specTemplateKeys.length === 0) return [];
  const specs =
    specifications && typeof specifications === 'object' && !Array.isArray(specifications)
      ? specifications
      : {};
  const missing = [];

  for (const rawKey of specTemplateKeys) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    let value = specs[key];
    if (value === undefined) {
      const matchedKey = Object.keys(specs).find(
        (candidate) => String(candidate || '').trim().toLowerCase() === key.toLowerCase()
      );
      value = matchedKey ? specs[matchedKey] : undefined;
    }
    if (!isMeaningfullyFilledSpecValue(value)) {
      missing.push(`Specification: ${key}`);
    }
  }

  return missing;
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

export const INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE =
  'Inventory completion is required before Product COV. Complete all mandatory Inventory details in Manage Inventory, then try again.';

export const PRODUCT_COV_OPEN_FROM_PRODUCT_MESSAGE =
  'You can go to Product COV through Manage Products or Manage Inventory. Open a product on those pages, then click Product COV.';

/** Map a saved offer/product row onto inventory form fields. */
export function getSupplierInventoryCompletionMissingFields(product = {}) {
  if (!product) {
    return getSupplierInventoryUpdateMissingFields({});
  }
  const attrs =
    product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  const missing = getSupplierInventoryUpdateMissingFields({
    price: product.price,
    stock: product.stock,
    sgst_rate: product.sgst_rate ?? product.sgstRate ?? attrs.sgstRate ?? attrs.sgst_rate,
    cgst_rate: product.cgst_rate ?? product.cgstRate ?? attrs.cgstRate ?? attrs.cgst_rate,
    igst_rate: product.igst_rate ?? product.igstRate ?? attrs.igstRate ?? attrs.igst_rate
  });
  const priceNum = Number(product.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    if (!missing.includes(SUPPLIER_MRP_LABEL)) missing.unshift(SUPPLIER_MRP_LABEL);
  }
  return missing;
}

export function isSupplierInventoryCompleteForProductCov(product) {
  return getSupplierInventoryCompletionMissingFields(product).length === 0;
}

export function formatInventoryRequiredForProductCovMessage(missingFields = []) {
  const missing = Array.isArray(missingFields) ? missingFields.filter(Boolean) : [];
  if (missing.length === 0) return INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE;
  return `Inventory completion is required before Product COV. Please complete: ${missing.join(', ')}.`;
}

/**
 * Mandatory fields for Manage Products catalog create/update (step 1).
 */
export function getSupplierCatalogMandatoryMissingFields(formData = {}, options = {}) {
  const {
    requirePhotos = false,
    minPhotos = MIN_SUPPLIER_PRODUCT_PHOTOS,
    photoCount,
    specTemplateKeys = [],
    specifications = null
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

  const specsSource =
    specifications != null
      ? specifications
      : formData.specifications && typeof formData.specifications === 'object'
        ? formData.specifications
        : {};
  missing.push(
    ...getSupplierSpecificationTemplateMissingFields(specTemplateKeys, specsSource)
  );

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
  const message = data.message ? String(data.message) : '';
  const haystack = [message, data.error, data.details, data.hint, data.code].filter(Boolean).join(' ');
  if (isPostgresUniqueConstraintMessage(haystack) || data.code === 'duplicate_supplier_variant') {
    return DUPLICATE_SUPPLIER_VARIANT_USER_MESSAGE;
  }
  if (message) return message;
  return 'Failed to update product';
}

export const DUPLICATE_SUPPLIER_VARIANT_USER_MESSAGE =
  'You have already added this exact product variation for this location. Please update the existing entry instead.';

export const DUPLICATE_CATALOG_PRODUCT_USER_MESSAGE =
  'A product with this identity already exists. Open that listing and update it instead of creating a duplicate.';

function collectClientErrorHaystack(data) {
  if (!data || typeof data !== 'object') return String(data || '');
  return [
    data.message,
    data.error,
    data.details,
    data.hint,
    data.code,
    data.constraint
  ]
    .map((value) => (value == null ? '' : String(value)))
    .filter(Boolean)
    .join(' ');
}

function isPostgresUniqueConstraintMessage(message) {
  return /duplicate key value violates unique constraint|violates unique constraint|product_supplier_location_variant|supplier_products_product_supplier_location_variant|23505/i.test(
    String(message || '')
  );
}

function isCatalogIdentityConstraintMessage(message) {
  return /idx_products_barcode|uq_products_|catalog_key_not_blank|products_.*_(gtin|asin|barcode|catalog_key)/i.test(
    String(message || '')
  );
}

export function getSupplierProductCreateErrorMessage(data) {
  if (!data || typeof data !== 'object') {
    return 'Failed to add product';
  }
  const haystack = collectClientErrorHaystack(data);
  if (isCatalogIdentityConstraintMessage(haystack) || data.code === 'duplicate_catalog_product') {
    if (
      data.code === 'duplicate_catalog_product' &&
      data.message &&
      !isPostgresUniqueConstraintMessage(data.message)
    ) {
      return String(data.message);
    }
    return DUPLICATE_CATALOG_PRODUCT_USER_MESSAGE;
  }
  if (isPostgresUniqueConstraintMessage(haystack) || data.code === 'duplicate_supplier_variant') {
    if (
      data.code === 'duplicate_supplier_variant' &&
      data.message &&
      !isPostgresUniqueConstraintMessage(data.message)
    ) {
      return String(data.message);
    }
    return DUPLICATE_SUPPLIER_VARIANT_USER_MESSAGE;
  }
  if (
    (data.code === 'product_photos_required' ||
      data.code === 'brand_approval_required' ||
      data.code === 'brand_approval_pending' ||
      data.code === 'brand_required' ||
      data.code === 'category_required' ||
      data.code === 'specifications_required' ||
      data.code === 'unit_incompatible' ||
      data.code === 'role_required') &&
    data.message &&
    !isPostgresUniqueConstraintMessage(data.message)
  ) {
    return String(data.message);
  }
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.filter(Boolean).join(' ');
  }
  const message = data.message ? String(data.message) : '';
  if (message && !isPostgresUniqueConstraintMessage(message)) return message;
  return 'Failed to add product';
}
