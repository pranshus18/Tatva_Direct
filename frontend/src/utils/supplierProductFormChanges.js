import { getSupplierOfferImagesForForm, normalizeProductImages } from './productImages';
import { resolveListingBrandIdentity } from './productBrandIdentity';
import { parseSupplierStockQuantity } from './parseSupplierStockQuantity';
import {
  getCanonicalGstRates,
  getCanonicalHsnCode,
  getCanonicalVariantMrp,
  parseSupplierOfferPrice
} from './supplierStockLabel';
import {
  getSupplierCatalogSpecificationKeys,
  isSupplierOfferApproved,
  mergeVariantSpecificationTemplate,
  resolveSavedSpecificationsForSupplierEdit,
  specificationsWithMeaningfulValuesOnly
} from './specifications';

const GST_KEYS = ['igst_rate', 'cgst_rate', 'sgst_rate'];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeTaxRate(value) {
  if (value === undefined || value === null || value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : normalizeText(value);
}

function normalizeHsn(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeGtin(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function normalizeImages(images) {
  return normalizeProductImages(images);
}

function normalizeSpecs(specifications) {
  return specificationsWithMeaningfulValuesOnly(specifications || {});
}

function stableSerialize(value) {
  if (value === undefined) return '';
  if (value === null) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return JSON.stringify(Object.fromEntries(keys.map((key) => [key, value[key]])));
  }
  return String(value);
}

function valuesEqual(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function getProductEditSpecifications(product) {
  if (!product) return {};
  const catalogKeys = getSupplierCatalogSpecificationKeys(product);
  const offerSpecs =
    product.supplierOfferSpecifications || product.attributes?.specifications || {};
  if (isSupplierOfferApproved(product.status) && catalogKeys.length > 0) {
    const template = Object.fromEntries(catalogKeys.map((key) => [key, '']));
    return mergeVariantSpecificationTemplate(template, offerSpecs);
  }
  return resolveSavedSpecificationsForSupplierEdit(product);
}

function buildEditFormDataFromProduct(product = {}) {
  const initialCanonicalGst = getCanonicalGstRates(product);
  const canonicalMrp = getCanonicalVariantMrp(product);
  const storedPrice = parseSupplierOfferPrice(product?.price);
  const price =
    storedPrice != null && storedPrice > 0
      ? storedPrice
      : canonicalMrp != null && canonicalMrp > 0
        ? canonicalMrp
        : product?.price || '';

  return {
    name: product?.name || '',
    brand: product?.brand || '',
    gtin: product?.gtin || '',
    hsnCode: product?.hsnCode || product?.hsn_code || getCanonicalHsnCode(product) || '',
    lsa: product?.lsa || product?.attributes?.lsa || '',
    category: product?.category || '',
    price,
    unit: product?.unit || '',
    stock: product?.stock != null && product?.stock !== '' ? String(product.stock) : '',
    igst_rate:
      product?.igst_rate != null && product?.igst_rate !== ''
        ? String(product.igst_rate)
        : initialCanonicalGst?.igstRate != null
          ? String(initialCanonicalGst.igstRate)
          : '',
    cgst_rate:
      product?.cgst_rate != null && product?.cgst_rate !== ''
        ? String(product.cgst_rate)
        : initialCanonicalGst?.cgstRate != null
          ? String(initialCanonicalGst.cgstRate)
          : '',
    sgst_rate:
      product?.sgst_rate != null && product?.sgst_rate !== ''
        ? String(product.sgst_rate)
        : initialCanonicalGst?.sgstRate != null
          ? String(initialCanonicalGst.sgstRate)
          : '',
    description: product?.supplierDescription || product?.description || '',
    images: getSupplierOfferImagesForForm(product)
  };
}

/**
 * Normalized snapshot of fields the Update Product action can actually persist
 * for the current modal (catalog vs inventory).
 */
export function buildSupplierProductFormSnapshot({
  formData = {},
  specifications = {},
  showInventoryFields = false,
  declaredBrandNames = []
} = {}) {
  if (showInventoryFields) {
    return {
      price: parseSupplierOfferPrice(formData.price),
      stock: parseSupplierStockQuantity(formData.stock),
      hsnCode: normalizeHsn(formData.hsnCode || formData.hsn_code),
      igst_rate: normalizeTaxRate(formData.igst_rate),
      cgst_rate: normalizeTaxRate(formData.cgst_rate),
      sgst_rate: normalizeTaxRate(formData.sgst_rate),
      lsa: normalizeText(formData.lsa),
      images: normalizeImages(formData.images)
    };
  }

  return {
    name: normalizeText(formData.name),
    brand: resolveListingBrandIdentity({
      selectedBrand: formData.brand,
      catalogBrand: formData.brand,
      productName: formData.name,
      declaredLabels: declaredBrandNames
    }),
    gtin: normalizeGtin(formData.gtin),
    category: normalizeText(formData.category),
    unit: normalizeText(formData.unit),
    description: normalizeText(formData.description),
    images: normalizeImages(formData.images),
    specifications: normalizeSpecs(specifications)
  };
}

/** Snapshot of the saved product using the same normalization as the edit form. */
export function buildSupplierProductEditBaseline(
  product,
  { showInventoryFields = false, declaredBrandNames = [] } = {}
) {
  if (!product) return null;
  return buildSupplierProductFormSnapshot({
    formData: buildEditFormDataFromProduct(product),
    specifications: getProductEditSpecifications(product),
    showInventoryFields,
    declaredBrandNames
  });
}

export function diffSupplierProductForm(current, baseline) {
  if (!current || !baseline) {
    return { hasChanges: false, changedKeys: [] };
  }
  const changedKeys = [];
  for (const key of Object.keys(current)) {
    if (!valuesEqual(current[key], baseline[key])) {
      changedKeys.push(key);
    }
  }
  return {
    hasChanges: changedKeys.length > 0,
    changedKeys
  };
}

/**
 * Copy only changed fields from the submit payload. GST rates are sent together
 * when any one of them changed so tax-combination validation still holds.
 */
export function pickChangedSupplierProductFields(productData = {}, current, baseline) {
  const { changedKeys } = diffSupplierProductForm(current, baseline);
  if (changedKeys.length === 0) return {};

  const gstChanged = changedKeys.some((key) => GST_KEYS.includes(key));
  const out = {};

  for (const key of changedKeys) {
    if (GST_KEYS.includes(key)) continue;
    if (productData[key] !== undefined) {
      out[key] = productData[key];
    }
  }

  if (gstChanged) {
    for (const key of GST_KEYS) {
      if (productData[key] !== undefined) {
        out[key] = productData[key];
      }
    }
  }

  return out;
}
