import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';

const INVENTORY_FIELD_KEYS = [
  'stock',
  'price',
  'location',
  'min_order_quantity',
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
 * Validate catalog identity updates when those fields are present in the request.
 */
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
