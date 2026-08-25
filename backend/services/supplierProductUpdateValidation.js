import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { validateProductUnitCompatibility } from '../utils/productUnitCompatibility.js';
import {
  countMeaningfulSpecValues,
  isMeaningfullyFilledSpecValue,
  normalizeSpecKeyForDedup,
  parseSpecificationsObject,
  specificationTemplateKeysOnly
} from './supplierCatalogHelpersService.js';

const INVENTORY_FIELD_KEYS = [
  'stock',
  'price',
  'location',
  'min_order_quantity',
  'lsa',
  'igst_rate',
  'igstRate',
  'cgst_rate',
  'cgstRate',
  'sgst_rate',
  'sgstRate',
  'hsnCode',
  'hsn_code'
];

const CATALOG_FIELD_KEYS = [
  'name',
  'brand',
  'brandModel',
  'category',
  'unit',
  'description',
  'gtin',
  'mpn',
  'specifications',
  'images'
];

const IGST_ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const CGST_SGST_ALLOWED_RATES = new Set([0, 2.5, 6, 9, 14]);

export function bodyHasInventoryUpdateFields(body = {}) {
  return INVENTORY_FIELD_KEYS.some((key) => body?.[key] !== undefined);
}

export function bodyHasCatalogUpdateFields(body = {}) {
  return CATALOG_FIELD_KEYS.some((key) => body?.[key] !== undefined);
}

function pushError(result, field, message) {
  result.ok = false;
  if (field) result.missingFields.push(field);
  result.errors.push(message);
}

function parseTaxRate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return NaN;
  return Number(parsed.toFixed(2));
}

function validateRequiredTaxRates(body = {}) {
  const igstRate = parseTaxRate(body.igst_rate ?? body.igstRate);
  const cgstRate = parseTaxRate(body.cgst_rate ?? body.cgstRate);
  const sgstRate = parseTaxRate(body.sgst_rate ?? body.sgstRate);

  if ([igstRate, cgstRate, sgstRate].every((v) => v === null)) {
    return {
      ok: false,
      message: 'SGST, CGST, and IGST are all required.',
      missingFields: ['sgst_rate', 'cgst_rate', 'igst_rate']
    };
  }
  if ([igstRate, cgstRate, sgstRate].some((v) => Number.isNaN(v))) {
    return {
      ok: false,
      message: 'Invalid tax rate value. Select values from the provided dropdown options only.',
      missingFields: ['igst_rate']
    };
  }
  if (igstRate === null || cgstRate === null || sgstRate === null) {
    return {
      ok: false,
      message: 'IGST, CGST, and SGST are all required together.',
      missingFields: ['sgst_rate', 'cgst_rate', 'igst_rate']
    };
  }
  if (!IGST_ALLOWED_RATES.has(igstRate)) {
    return {
      ok: false,
      message: 'Invalid IGST rate. Allowed values are 0, 5, 12, 18, and 28.',
      missingFields: ['igst_rate']
    };
  }
  if (!CGST_SGST_ALLOWED_RATES.has(cgstRate) || !CGST_SGST_ALLOWED_RATES.has(sgstRate)) {
    return {
      ok: false,
      message: 'Invalid CGST/SGST rate. Allowed values are 0, 2.5, 6, 9, and 14.',
      missingFields: ['cgst_rate', 'sgst_rate']
    };
  }
  if (cgstRate !== sgstRate) {
    return {
      ok: false,
      message: 'CGST and SGST must be the same percentage.',
      missingFields: ['cgst_rate', 'sgst_rate']
    };
  }
  if (Number((cgstRate + sgstRate).toFixed(2)) !== igstRate) {
    return {
      ok: false,
      message: 'IGST must equal CGST + SGST.',
      missingFields: ['igst_rate']
    };
  }
  return { ok: true, message: '', missingFields: [] };
}

/**
 * Validate Manage Inventory updates: MRP, stock, and GST rates are mandatory together.
 */
export function validateSupplierInventoryUpdateFields(body = {}) {
  const result = {
    ok: true,
    missingFields: [],
    errors: [],
    message: ''
  };

  if (body.stock === undefined) {
    pushError(
      result,
      'stock',
      'Current stock with you is required and must be a whole number (0 or greater).'
    );
  } else {
    const stock = parseSupplierStockQuantity(body.stock);
    if (stock === null) {
      pushError(
        result,
        'stock',
        'Current stock with you is required and must be a whole number (0 or greater).'
      );
    }
  }

  const priceRaw = body.price;
  const priceEmpty = priceRaw === undefined || priceRaw === null || String(priceRaw).trim() === '';
  const priceNum = Number(priceRaw);
  if (priceEmpty || !Number.isFinite(priceNum) || priceNum < 0) {
    pushError(result, 'price', 'MRP is required and must be a valid amount (0 or greater).');
  }

  const taxValidation = validateRequiredTaxRates(body);
  if (!taxValidation.ok) {
    pushError(result, taxValidation.missingFields?.[0] || 'igst_rate', taxValidation.message);
    (taxValidation.missingFields || []).slice(1).forEach((field) => result.missingFields.push(field));
  }

  result.missingFields = [...new Set(result.missingFields.filter(Boolean))];
  result.message = result.errors.join(' ');
  return result;
}

/**
 * When admin has defined specification keys for a category, every key must have a value
 * before the supplier can submit the product.
 */
export function getMissingSupplierSpecificationTemplateFields(templateKeys = [], specifications = {}) {
  const specs = parseSpecificationsObject(specifications) || {};
  const missingFields = [];
  const errors = [];

  for (const rawKey of templateKeys || []) {
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
      missingFields.push(`specifications.${key}`);
      errors.push(`Specification "${key}" is required for this category.`);
    }
  }

  return {
    ok: missingFields.length === 0,
    missingFields,
    errors,
    message: errors.join(' ')
  };
}

/** True when the supplier completed the one-time post-approval specification fill. */
export function areSupplierOfferSpecificationValuesLocked(
  supplierProduct = {},
  catalogSpecificationKeys = []
) {
  const offerSpecs =
    parseSpecificationsObject(supplierProduct?.attributes?.specifications) ||
    parseSpecificationsObject(supplierProduct?.specifications) ||
    {};
  const status = String(supplierProduct?.status || 'pending').trim().toLowerCase();
  const isApproved = status === 'approved' || status === 'active';
  const templateKeys = Array.isArray(catalogSpecificationKeys)
    ? catalogSpecificationKeys.filter(Boolean)
    : [];

  if (isApproved && templateKeys.length > 0) {
    return templateKeys.every((key) => {
      if (isMeaningfullyFilledSpecValue(offerSpecs[key])) return true;
      const targetNorm = normalizeSpecKeyForDedup(key);
      if (!targetNorm) return false;
      return Object.entries(offerSpecs).some(
        ([offerKey, value]) =>
          normalizeSpecKeyForDedup(offerKey) === targetNorm &&
          isMeaningfullyFilledSpecValue(value)
      );
    });
  }

  if (!isApproved) {
    return false;
  }

  return countMeaningfulSpecValues(offerSpecs) > 0;
}

/** Require every category template key when that category already has admin-defined specifications. */
export async function validateSupplierCategorySpecificationFillComplete(
  resolveAdminSpecificationTemplate,
  {
    categoryName = '',
    modelRaw = '',
    brandRaw = '',
    specifications = {}
  } = {}
) {
  const normalizedCategory = String(categoryName || '').trim().toLowerCase();
  if (!normalizedCategory) {
    return { ok: true, missingFields: [], errors: [], message: '' };
  }

  const template =
    typeof resolveAdminSpecificationTemplate === 'function'
      ? await resolveAdminSpecificationTemplate({
          categoryName: normalizedCategory,
          modelRaw,
          brandRaw,
          keysOnly: true
        })
      : {};
  const templateKeys = Object.keys(template || {});
  if (templateKeys.length === 0) {
    return { ok: true, missingFields: [], errors: [], message: '' };
  }

  return getMissingSupplierSpecificationTemplateFields(templateKeys, specifications);
}

/** Require every admin catalog specification key when the supplier is filling values post-approval. */
export async function validateSupplierOfferSpecificationFillComplete(
  supabase,
  { productId, specifications = {} } = {}
) {
  if (!productId || !supabase) {
    return { ok: true, missingFields: [], errors: [], message: '' };
  }

  const { data: catalogRow } = await supabase
    .from('products')
    .select('specifications')
    .eq('id', productId)
    .maybeSingle();

  const templateKeys = Object.keys(
    specificationTemplateKeysOnly(parseSpecificationsObject(catalogRow?.specifications) || {})
  );
  if (templateKeys.length === 0) {
    return { ok: true, missingFields: [], errors: [], message: '' };
  }

  return getMissingSupplierSpecificationTemplateFields(templateKeys, specifications);
}

export function validateSupplierCatalogUpdateFields(body = {}) {
  const result = {
    ok: true,
    missingFields: [],
    errors: [],
    message: ''
  };

  if (body.name !== undefined && !String(body.name || '').trim()) {
    pushError(result, 'name', 'Product name is required.');
  }

  if (body.category !== undefined && !String(body.category || '').trim()) {
    pushError(result, 'category', 'Category is required.');
  }

  if (body.brand !== undefined && !String(body.brand || '').trim()) {
    pushError(result, 'brand', 'Brand is required.');
  }

  if (body.brandModel !== undefined && !String(body.brandModel || '').trim()) {
    pushError(result, 'brandModel', 'Brand is required.');
  }

  if (body.unit !== undefined && String(body.unit || '').trim()) {
    const unitCheck = validateProductUnitCompatibility({
      unit: body.unit,
      productName: body.name,
      category: body.category
    });
    if (!unitCheck.ok && unitCheck.severity === 'error') {
      pushError(result, 'unit', unitCheck.message);
    }
  }

  result.missingFields = [...new Set(result.missingFields.filter(Boolean))];
  result.message = result.errors.join(' ');
  return result;
}

/**
 * Full PUT /products/:id request validation for supplier portal updates.
 */
export function validateSupplierProductUpdateRequest(body = {}) {
  const hasInventory = bodyHasInventoryUpdateFields(body);
  const hasCatalog = bodyHasCatalogUpdateFields(body);

  if (hasInventory) {
    const inventoryResult = validateSupplierInventoryUpdateFields(body);
    if (!inventoryResult.ok) {
      return {
        ...inventoryResult,
        code: 'inventory_validation_error'
      };
    }
  }

  if (hasCatalog) {
    const catalogResult = validateSupplierCatalogUpdateFields(body);
    if (!catalogResult.ok) {
      return {
        ...catalogResult,
        code: 'catalog_validation_error'
      };
    }
  }

  return {
    ok: true,
    missingFields: [],
    errors: [],
    message: '',
    code: null
  };
}

function parseStoredOfferPrice(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** True once a supplier offer has a saved MRP greater than zero. */
export function isSupplierMrpLocked(supplierProduct = {}) {
  const price = parseStoredOfferPrice(supplierProduct?.price);
  return price !== null && price > 0;
}

export const SUPPLIER_MRP_LOCKED_MESSAGE =
  'MRP cannot be changed after it has been saved. Contact admin to update MRP.';

/** Block supplier attempts to change a locked MRP. */
export function validateSupplierMrpUpdateAllowed(supplierProduct = {}, body = {}) {
  if (body?.price === undefined) {
    return { ok: true, message: '', code: null };
  }
  if (!isSupplierMrpLocked(supplierProduct)) {
    return { ok: true, message: '', code: null };
  }

  const currentPrice = parseStoredOfferPrice(supplierProduct.price);
  const nextPrice = parseStoredOfferPrice(body.price);
  if (currentPrice === null || nextPrice === null || nextPrice !== currentPrice) {
    return {
      ok: false,
      message: SUPPLIER_MRP_LOCKED_MESSAGE,
      code: 'mrp_locked',
      missingFields: ['price']
    };
  }

  return { ok: true, message: '', code: null };
}

function isSupplierOfferApproved(product = {}) {
  const status = String(product?.status || product?.offerStatus || '').trim().toLowerCase();
  return status === 'approved' || status === 'active';
}

function parseStoredHsnCode(product = {}) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  return String(product?.hsnCode || product?.hsn_code || attrs.hsnCode || attrs.hsn_code || '').replace(
    /\D/g,
    ''
  );
}

function parseStoredGtin(product = {}, catalogProduct = {}) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  return String(product?.gtin || attrs.gtin || catalogProduct?.gtin || '')
    .replace(/\s+/g, '')
    .trim();
}

function parseStoredGstRates(product = {}) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  return {
    igst: parseTaxRate(product?.igst_rate ?? product?.igstRate ?? attrs.igstRate ?? attrs.igst_rate),
    cgst: parseTaxRate(product?.cgst_rate ?? product?.cgstRate ?? attrs.cgstRate ?? attrs.cgst_rate),
    sgst: parseTaxRate(product?.sgst_rate ?? product?.sgstRate ?? attrs.sgstRate ?? attrs.sgst_rate)
  };
}

export function isSupplierHsnLocked(product = {}) {
  return isSupplierOfferApproved(product) && Boolean(parseStoredHsnCode(product));
}

export function isSupplierGstLocked(product = {}) {
  if (!isSupplierOfferApproved(product)) return false;
  const { igst, cgst, sgst } = parseStoredGstRates(product);
  return [igst, cgst, sgst].every((rate) => rate !== null && !Number.isNaN(rate));
}

export function isSupplierGtinLocked(product = {}, catalogProduct = {}) {
  return isSupplierOfferApproved(product) && Boolean(parseStoredGtin(product, catalogProduct));
}

export const SUPPLIER_HSN_LOCKED_MESSAGE =
  'HSN code cannot be changed after the product is approved. Contact admin to update it.';
export const SUPPLIER_GST_LOCKED_MESSAGE =
  'GST rates cannot be changed after the product is approved. Contact admin to update them.';
export const SUPPLIER_GTIN_LOCKED_MESSAGE =
  'GTIN / UPC / EAN cannot be changed after the product is approved. Contact admin to update it.';

function bodyHasGstFields(body = {}) {
  return ['igst_rate', 'igstRate', 'cgst_rate', 'cgstRate', 'sgst_rate', 'sgstRate'].some(
    (key) => body?.[key] !== undefined
  );
}

/** Block supplier edits to approved HSN, GST, and GTIN values. */
export function validateSupplierApprovedIdentityUpdateAllowed(
  supplierProduct = {},
  body = {},
  { catalogProduct = {} } = {}
) {
  if (isSupplierHsnLocked(supplierProduct) && (body.hsnCode !== undefined || body.hsn_code !== undefined)) {
    const nextHsn = String(body.hsnCode !== undefined ? body.hsnCode : body.hsn_code || '').replace(
      /\D/g,
      ''
    );
    if (nextHsn !== parseStoredHsnCode(supplierProduct)) {
      return {
        ok: false,
        message: SUPPLIER_HSN_LOCKED_MESSAGE,
        code: 'hsn_locked',
        missingFields: ['hsnCode']
      };
    }
  }

  if (isSupplierGstLocked(supplierProduct) && bodyHasGstFields(body)) {
    const current = parseStoredGstRates(supplierProduct);
    const next = {
      igst: parseTaxRate(body.igst_rate ?? body.igstRate ?? current.igst),
      cgst: parseTaxRate(body.cgst_rate ?? body.cgstRate ?? current.cgst),
      sgst: parseTaxRate(body.sgst_rate ?? body.sgstRate ?? current.sgst)
    };
    if (next.igst !== current.igst || next.cgst !== current.cgst || next.sgst !== current.sgst) {
      return {
        ok: false,
        message: SUPPLIER_GST_LOCKED_MESSAGE,
        code: 'gst_locked',
        missingFields: ['igst_rate']
      };
    }
  }

  if (isSupplierGtinLocked(supplierProduct, catalogProduct) && body.gtin !== undefined) {
    const nextGtin = String(body.gtin || '')
      .replace(/\s+/g, '')
      .trim();
    if (nextGtin !== parseStoredGtin(supplierProduct, catalogProduct)) {
      return {
        ok: false,
        message: SUPPLIER_GTIN_LOCKED_MESSAGE,
        code: 'gtin_locked',
        missingFields: ['gtin']
      };
    }
  }

  return { ok: true, message: '', code: null };
}

function normalizeSpecValueForCompare(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join(', ').trim();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

export const SUPPLIER_SPEC_VALUES_LOCKED_MESSAGE =
  'Specification values cannot be changed after they have been saved. Contact admin if a correction is needed.';

/** Block edits to specification values that were already saved with data. */
export function validateSupplierSpecificationUpdateAllowed(supplierProduct = {}, body = {}) {
  if (body?.specifications === undefined) {
    return { ok: true, message: '', code: null };
  }

  const existing =
    parseSpecificationsObject(supplierProduct?.attributes?.specifications) ||
    parseSpecificationsObject(supplierProduct?.specifications) ||
    {};
  const next = parseSpecificationsObject(body.specifications) || {};

  for (const [key, value] of Object.entries(existing)) {
    if (!isMeaningfullyFilledSpecValue(value)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return {
        ok: false,
        message: SUPPLIER_SPEC_VALUES_LOCKED_MESSAGE,
        code: 'spec_values_locked',
        missingFields: ['specifications']
      };
    }
    if (normalizeSpecValueForCompare(value) !== normalizeSpecValueForCompare(next[key])) {
      return {
        ok: false,
        message: SUPPLIER_SPEC_VALUES_LOCKED_MESSAGE,
        code: 'spec_values_locked',
        missingFields: ['specifications']
      };
    }
  }

  return { ok: true, message: '', code: null };
}
