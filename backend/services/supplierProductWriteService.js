import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { buildSupplierDescriptionAttributes } from '../utils/supplierProductDescriptions.js';
import { syncOfferAttributesWithSpecifications } from './productIdentityService.js';
import {
  isPgUniqueViolation,
  parsePgUniqueViolationIdentity,
  toCatalogProductWriteErrorResponse
} from '../utils/supplierOfferUniqueness.js';
import {
  catalogBrandsCompatible,
  catalogBrandsConflict,
  catalogCategoriesConflict,
  normalizeCatalogLookupName
} from '../utils/catalogProductAttach.js';
import { buildDisambiguatedAsinLikeId } from './productIdentityService.js';

function normalizeOfferPrice(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

function pickBestOfferBucket(offers = []) {
  const approvedActive = offers.filter(
    (o) => String(o?.status || '').toLowerCase() === 'approved' && o?.is_active === true
  );
  if (approvedActive.length > 0) return approvedActive;

  const approved = offers.filter((o) => String(o?.status || '').toLowerCase() === 'approved');
  if (approved.length > 0) return approved;

  return offers;
}

export function pickLockedVariantPriceFromOffers(offers = []) {
  const normalizedOffers = (offers || [])
    .map((offer) => ({
      ...offer,
      price: normalizeOfferPrice(offer?.price)
    }))
    .filter((offer) => offer.price !== null);
  if (normalizedOffers.length === 0) return null;

  const bucket = pickBestOfferBucket(normalizedOffers);
  if (bucket.length === 0) return null;
  return bucket[0].price;
}

export const pickLockedProductPriceFromOffers = pickLockedVariantPriceFromOffers;

export async function resolveLockedVariantPrice(
  supabase,
  { productId, excludeSupplierProductId = null } = {}
) {
  if (!productId) return null;

  let query = supabase
    .from('supplier_products')
    .select('id, price, status, is_active, updated_at')
    .eq('product_id', productId)
    .neq('status', 'rejected')
    .order('updated_at', { ascending: true });

  if (excludeSupplierProductId) {
    query = query.neq('id', excludeSupplierProductId);
  }

  const { data, error } = await query.limit(200);
  if (error || !Array.isArray(data) || data.length === 0) return null;

  return pickLockedVariantPriceFromOffers(data);
}

export async function findCanonicalProductFromIdentifiers(supabase, { gtinInput, resolvedBarcodeForPos }) {
  let canonicalProductFromIdentifier = null;
  if (gtinInput) {
    const { data: byGtin } = await supabase
      .from('products')
      .select('id, status, brand, gtin, barcode, name, category, specifications')
      .eq('gtin', gtinInput)
      .maybeSingle();
    if (byGtin) canonicalProductFromIdentifier = byGtin;
  }
  if (!canonicalProductFromIdentifier && resolvedBarcodeForPos) {
    const { data: byBarcode } = await supabase
      .from('products')
      .select('id, status, brand, gtin, barcode, name, category, specifications')
      .eq('barcode', resolvedBarcodeForPos)
      .maybeSingle();
    if (byBarcode) canonicalProductFromIdentifier = byBarcode;
  }
  return canonicalProductFromIdentifier;
}

export async function ensureCategoryAndUnit(supabase, { category, unit, reqUserId }) {
  let categoryName = category?.trim().toLowerCase();
  if (categoryName) {
    let { data: categoryDoc } = await supabase
      .from('categories')
      .select('*')
      .eq('name', categoryName)
      .single();

    if (!categoryDoc) {
      const { data: newCategory } = await supabase
        .from('categories')
        .insert({
          name: categoryName,
          display_name: category.trim(),
          created_by: reqUserId
        })
        .select()
        .single();
      categoryDoc = newCategory;
    }
  }

  let unitName = unit?.trim().toLowerCase();
  if (unitName) {
    let { data: unitDoc } = await supabase
      .from('units')
      .select('*')
      .eq('name', unitName)
      .single();

    if (!unitDoc) {
      const { data: newUnit } = await supabase
        .from('units')
        .insert({
          name: unitName,
          display_name: unit.trim(),
          created_by: reqUserId
        })
        .select()
        .single();
      unitDoc = newUnit;
    }
  }

  return { categoryName, unitName };
}

/**
 * Resolve a shared catalog product to attach this offer to.
 * Returns { product, matchStrength } where matchStrength is one of:
 *   - explicit: UI catalog pick
 *   - strong: GTIN / brand+MPN / identifier / catalog_key
 *   - weak: exact name + category only (never auto-approves)
 *   - none
 *
 * Never falls back to a partial name match, and never links when both sides declare
 * conflicting brands (prevents reusing an unrelated product's name/TSIN).
 */
export async function findExistingProductCandidate(
  supabase,
  {
    selectedCatalogProductId,
    canonicalProductFromIdentifier,
    identityBundle,
    productName,
    productNameRaw,
    categoryName,
    normalizeText
  }
) {
  const candidateBrand = normalizeText?.(identityBundle?.catalog?.brand) || '';
  const candidateGtin = String(identityBundle?.catalog?.gtin || '').trim();
  const submittedCategory = categoryName || identityBundle?.catalog?.category || '';

  const brandsCompatible = (product) =>
    catalogBrandsCompatible(candidateBrand, product?.brand);

  const acceptCandidate = (product, matchStrength) => {
    if (!product) return { product: null, matchStrength: 'none' };
    const existingGtin = String(product.gtin || '').trim();
    const gtinExact = Boolean(candidateGtin && existingGtin && candidateGtin === existingGtin);
    // GTIN is true product identity. Everything else must stay in the same category
    // so a flask/bottle listing cannot reuse a footwear catalog row.
    if (!gtinExact && catalogCategoriesConflict(submittedCategory, product.category)) {
      return { product: null, matchStrength: 'none' };
    }
    return { product, matchStrength };
  };

  if (selectedCatalogProductId) {
    const { data: bySelectedId } = await supabase
      .from('products')
      .select('id, status, brand, gtin, barcode, name, category, asin, catalog_key, specifications')
      .eq('id', selectedCatalogProductId)
      .maybeSingle();
    if (bySelectedId && !catalogBrandsConflict(candidateBrand, bySelectedId.brand)) {
      return acceptCandidate(bySelectedId, 'explicit');
    }
  }

  if (
    canonicalProductFromIdentifier &&
    !catalogBrandsConflict(candidateBrand, canonicalProductFromIdentifier.brand)
  ) {
    return acceptCandidate(canonicalProductFromIdentifier, 'strong');
  }

  if (identityBundle?.catalog?.gtin) {
    const { data: byGtin } = await supabase
      .from('products')
      .select('*')
      .eq('gtin', identityBundle.catalog.gtin)
      .maybeSingle();
    if (byGtin && !catalogBrandsConflict(candidateBrand, byGtin.brand)) {
      return acceptCandidate(byGtin, 'strong');
    }
  }

  if (identityBundle?.catalog?.brand && identityBundle?.catalog?.mpn) {
    const { data: byBrandMpn } = await supabase
      .from('products')
      .select('*')
      .eq('brand', identityBundle.catalog.brand)
      .eq('mpn', identityBundle.catalog.mpn)
      .maybeSingle();
    if (byBrandMpn) {
      return acceptCandidate(byBrandMpn, 'strong');
    }
  }

  if (identityBundle?.catalogKey) {
    const { data: byCatalogKey } = await supabase
      .from('products')
      .select('*')
      .eq('catalog_key', identityBundle.catalogKey)
      .maybeSingle();
    if (byCatalogKey) {
      // catalog_key includes name/category/brand/unit — treat as strong when brands agree.
      if (brandsCompatible(byCatalogKey)) {
        return acceptCandidate(byCatalogKey, 'strong');
      }
    }
  }

  if (productName && categoryName) {
    // Escape ILIKE wildcards so product names with %/_ do not partial-match others.
    const escapedName = String(productNameRaw || productName || '')
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const { data: productsByName, error: nameSearchError } = await supabase
      .from('products')
      .select('*')
      .eq('category', categoryName)
      .ilike('name', escapedName);
    if (!nameSearchError && productsByName?.length) {
      const exactMatch = productsByName.find(
        (p) =>
          normalizeText?.(p.name) === normalizeText?.(productNameRaw || productName) &&
          brandsCompatible(p)
      );
      if (exactMatch) {
        return acceptCandidate(exactMatch, 'weak');
      }
    }
  }

  return { product: null, matchStrength: 'none' };
}

/**
 * Supplier portal display name for an offer:
 * prefer the supplier's own listing title over the shared catalog name so a
 * mis-linked or multi-offer row cannot silently steal another product's name.
 */
export function resolveSupplierOfferDisplayName({ attributes = {}, catalogName = '' } = {}) {
  const listingName =
    attributes?.listingName != null && String(attributes.listingName).trim() !== ''
      ? String(attributes.listingName).trim()
      : '';
  if (listingName) return listingName;
  const offerName =
    attributes?.name != null && String(attributes.name).trim() !== ''
      ? String(attributes.name).trim()
      : '';
  if (offerName) return offerName;
  const catalog = catalogName != null && String(catalogName).trim() !== '' ? String(catalogName).trim() : '';
  return catalog || 'Product';
}

/** Supplier-submitted category wins over a mis-linked shared catalog row. */
export function resolveSupplierOfferDisplayCategory({ attributes = {}, catalogCategory = '' } = {}) {
  const offerCategory =
    attributes?.category != null && String(attributes.category).trim() !== ''
      ? String(attributes.category).trim()
      : '';
  if (offerCategory) return offerCategory;
  return catalogCategory != null && String(catalogCategory).trim() !== ''
    ? String(catalogCategory).trim()
    : '';
}

/**
 * Unique-constraint recovery may find a row that only shares a short TSIN/ASIN.
 * Reuse that row only when it is actually the same catalog product.
 */
export function isSameCatalogProductForRecovery(recovered, identityBundle = {}) {
  if (!recovered?.id) return false;
  const catalog = identityBundle.catalog || {};
  const recoveredGtin = String(recovered.gtin || '').trim();
  const candidateGtin = String(catalog.gtin || '').trim();
  if (candidateGtin && recoveredGtin && candidateGtin === recoveredGtin) return true;

  const recoveredKey = String(recovered.catalog_key || '').trim();
  const candidateKey = String(identityBundle.catalogKey || '').trim();
  if (candidateKey && recoveredKey && candidateKey === recoveredKey) return true;

  const recoveredName = normalizeCatalogLookupName(recovered.name);
  const candidateName = normalizeCatalogLookupName(catalog.name);
  const namesMatch = Boolean(recoveredName && candidateName && recoveredName === candidateName);
  const categoriesMatch = !catalogCategoriesConflict(catalog.category, recovered.category);
  const brandsOk = !catalogBrandsConflict(catalog.brand, recovered.brand);
  return namesMatch && categoriesMatch && brandsOk;
}

/** Move a rejected shared catalog product back to pending when a supplier resubmits it. */
export async function reopenRejectedCatalogProductForResubmit(supabase, productId) {
  if (!productId || !supabase) return null;
  const { data: catalogRow } = await supabase
    .from('products')
    .select('id, status')
    .eq('id', productId)
    .maybeSingle();
  if (!catalogRow || String(catalogRow.status || '').toLowerCase() !== 'rejected') {
    return catalogRow || null;
  }
  const nowIso = new Date().toISOString();
  const { data: reopened, error } = await supabase
    .from('products')
    .update({
      status: 'pending',
      is_active: false,
      rejection_reason: null,
      approved_by: null,
      approved_at: null,
      updated_at: nowIso
    })
    .eq('id', productId)
    .select('id, status')
    .maybeSingle();
  if (error) {
    console.warn('[SupplierProductCreate] Failed to reopen rejected catalog product:', error.message || error);
    return catalogRow;
  }
  return reopened || { ...catalogRow, status: 'pending' };
}

const CATALOG_RECOVERY_SELECT =
  'id, status, brand, gtin, barcode, name, category, specifications, asin, catalog_key';

export async function recoverExistingCatalogProduct(
  supabase,
  { identityBundle, resolvedBarcodeForPos, uniqueError } = {}
) {
  if (!supabase) return null;
  const gtin = String(identityBundle?.catalog?.gtin || '').trim();
  const barcode = String(resolvedBarcodeForPos || '').trim();
  const catalogKey = String(identityBundle?.catalogKey || '').trim();
  const asin = String(identityBundle?.asinLikeId || '').trim();
  const brand = String(identityBundle?.catalog?.brand || '').trim();
  const mpn = String(identityBundle?.catalog?.mpn || '').trim();

  const lookup = async (column, value) => {
    if (!value) return null;
    const { data, error } = await supabase
      .from('products')
      .select(CATALOG_RECOVERY_SELECT)
      .eq(column, value)
      .maybeSingle();
    if (error) return null;
    return data || null;
  };

  if (gtin) {
    const byGtin = await lookup('gtin', gtin);
    if (byGtin) return byGtin;
  }
  if (barcode) {
    const byBarcode = await lookup('barcode', barcode);
    if (byBarcode) return byBarcode;
  }
  const conflict = parsePgUniqueViolationIdentity(uniqueError);
  if (conflict?.value && ['barcode', 'gtin', 'asin', 'catalog_key'].includes(conflict.column)) {
    const byConflict = await lookup(conflict.column, conflict.value);
    if (byConflict) return byConflict;
  }
  if (catalogKey) {
    const byCatalogKey = await lookup('catalog_key', catalogKey);
    if (byCatalogKey) return byCatalogKey;
  }
  if (asin) {
    const byAsin = await lookup('asin', asin);
    if (byAsin) return byAsin;
  }
  if (brand && mpn) {
    const { data, error } = await supabase
      .from('products')
      .select(CATALOG_RECOVERY_SELECT)
      .eq('brand', brand)
      .eq('mpn', mpn)
      .maybeSingle();
    if (!error && data) return data;
  }
  return null;
}

export async function createBaseProductIfNeeded(
  supabase,
  { existingProduct, otherData, categoryName, unitName, normalizedImageUrls, normalizedSpecs, reqUserId, identityBundle, resolvedBarcodeForPos }
) {
  let productId;
  let catalogAsin;
  let isNewProduct = false;

  if (existingProduct) {
    productId = existingProduct.id;
    catalogAsin = existingProduct.asin || identityBundle.asinLikeId;
    return { productId, catalogAsin, isNewProduct };
  }

  const basePrice = otherData.price !== undefined ? parseFloat(otherData.price) : 0;
  const baseStock =
    otherData.stock !== undefined ? parseSupplierStockQuantity(otherData.stock) : 0;
  const baseMinOrderQty = otherData.min_order_quantity !== undefined ? parseInt(otherData.min_order_quantity) : 1;
  const baseLocation = (otherData.location || '').trim() || 'Not specified';
  const productData = {
    name: otherData.name,
    // Customer-facing description is curated by admin after supplier submission.
    description: '',
    category: categoryName,
    unit: unitName,
    images: normalizedImageUrls,
    specifications: normalizedSpecs,
    supplier_id: reqUserId,
    price: isNaN(basePrice) ? 0 : basePrice,
    stock: baseStock == null ? 0 : baseStock,
    min_order_quantity: isNaN(baseMinOrderQty) || baseMinOrderQty < 1 ? 1 : baseMinOrderQty,
    location: baseLocation,
    asin: identityBundle.asinLikeId,
    gtin: identityBundle.catalog.gtin || null,
    mpn: identityBundle.catalog.mpn || null,
    brand: identityBundle.catalog.brand || null,
    catalog_key: identityBundle.catalogKey,
    // Explicit pending so DB is_active defaults (true) cannot be mistaken for admin approval.
    status: 'pending',
    is_active: false
  };
  if (resolvedBarcodeForPos) productData.barcode = resolvedBarcodeForPos;

  const { data: newProduct, error: createError } = await supabase
    .from('products')
    .insert(productData)
    .select()
    .single();
  if (createError) {
    if (isPgUniqueViolation(createError)) {
      const recovered = await recoverExistingCatalogProduct(supabase, {
        identityBundle,
        resolvedBarcodeForPos,
        uniqueError: createError
      });
      if (recovered?.id && isSameCatalogProductForRecovery(recovered, identityBundle)) {
        return {
          productId: recovered.id,
          catalogAsin: recovered.asin || identityBundle.asinLikeId,
          isNewProduct: false
        };
      }
      const conflict = parsePgUniqueViolationIdentity(createError);
      const errorHaystack = `${createError?.message || ''} ${createError?.details || ''} ${createError?.constraint || ''}`;
      const barcodeConflict =
        conflict?.column === 'barcode' ||
        /idx_products_barcode|products_.*barcode/i.test(errorHaystack);
      const asinConflict =
        conflict?.column === 'asin' ||
        /uq_products_asin|products_.*asin/i.test(errorHaystack);
      if (barcodeConflict && productData.barcode) {
        const retryPayload = { ...productData };
        delete retryPayload.barcode;
        const { data: retriedProduct, error: retryError } = await supabase
          .from('products')
          .insert(retryPayload)
          .select()
          .single();
        if (!retryError && retriedProduct?.id) {
          return {
            productId: retriedProduct.id,
            catalogAsin: retriedProduct.asin || identityBundle.asinLikeId,
            isNewProduct: true
          };
        }
        if (retryError && isPgUniqueViolation(retryError)) {
          const retryRecovered = await recoverExistingCatalogProduct(supabase, {
            identityBundle,
            resolvedBarcodeForPos: null,
            uniqueError: retryError
          });
          if (retryRecovered?.id && isSameCatalogProductForRecovery(retryRecovered, identityBundle)) {
            return {
              productId: retryRecovered.id,
              catalogAsin: retryRecovered.asin || identityBundle.asinLikeId,
              isNewProduct: false
            };
          }
        }
      }
      if (asinConflict) {
        const baseAsin = String(productData.asin || identityBundle?.asinLikeId || '').trim();
        for (let attempt = 1; attempt <= 8; attempt += 1) {
          const retryPayload = {
            ...productData,
            asin: buildDisambiguatedAsinLikeId(
              baseAsin,
              `${identityBundle?.catalogKey || ''}:${attempt}`
            )
          };
          const { data: retriedProduct, error: retryError } = await supabase
            .from('products')
            .insert(retryPayload)
            .select()
            .single();
          if (!retryError && retriedProduct?.id) {
            return {
              productId: retriedProduct.id,
              catalogAsin: retriedProduct.asin || retryPayload.asin,
              isNewProduct: true
            };
          }
          if (!retryError || !isPgUniqueViolation(retryError)) {
            return {
              error: retryError || createError,
              publicError: toCatalogProductWriteErrorResponse(retryError || createError)
            };
          }
          const retryRecovered = await recoverExistingCatalogProduct(supabase, {
            identityBundle,
            resolvedBarcodeForPos,
            uniqueError: retryError
          });
          if (retryRecovered?.id && isSameCatalogProductForRecovery(retryRecovered, identityBundle)) {
            return {
              productId: retryRecovered.id,
              catalogAsin: retryRecovered.asin || identityBundle.asinLikeId,
              isNewProduct: false
            };
          }
        }
      }
    }
    return {
      error: createError,
      publicError: toCatalogProductWriteErrorResponse(createError)
    };
  }

  productId = newProduct.id;
  catalogAsin = newProduct.asin || identityBundle.asinLikeId;
  isNewProduct = true;
  return { productId, catalogAsin, isNewProduct };
}

export function buildSupplierProductUpdatePayload({
  reqBody,
  supplierProduct,
  validateAndNormalizeTaxRates,
  sanitizeImageUrls,
  normalizeGtin,
  isValidGtin,
  shouldMoveToPendingForSpecChange
}) {
  const parsedPrice = parseFloat(reqBody.price);
  const parsedStock =
    reqBody.stock !== undefined ? parseSupplierStockQuantity(reqBody.stock) : null;
  const parsedMinOrderQty = parseInt(
    reqBody.min_order_quantity !== undefined ? reqBody.min_order_quantity : supplierProduct.min_order_quantity || 1
  );
  const taxFieldsProvided =
    reqBody.igst_rate !== undefined ||
    reqBody.igstRate !== undefined ||
    reqBody.cgst_rate !== undefined ||
    reqBody.cgstRate !== undefined ||
    reqBody.sgst_rate !== undefined ||
    reqBody.sgstRate !== undefined;

  const updateSupplierProductData = {};

  if (reqBody.price !== undefined) {
    updateSupplierProductData.price = Number.isFinite(parsedPrice) ? parsedPrice : supplierProduct.price;
    updateSupplierProductData.price_updated_at = new Date().toISOString();
  }
  if (reqBody.stock !== undefined) {
    if (parsedStock === null) {
      return { error: 'Enter a valid whole-number stock quantity (0 or greater).' };
    }
    updateSupplierProductData.stock = parsedStock;
  }
  if (reqBody.location !== undefined) {
    const newLocation = (reqBody.location || '').trim();
    updateSupplierProductData.location = newLocation || supplierProduct.location;
  }
  if (reqBody.min_order_quantity !== undefined) {
    updateSupplierProductData.min_order_quantity =
      Number.isInteger(parsedMinOrderQty) && parsedMinOrderQty > 0
        ? parsedMinOrderQty
        : supplierProduct.min_order_quantity || 1;
  }

  if (taxFieldsProvided) {
    const taxValidation = validateAndNormalizeTaxRates(reqBody);
    if (!taxValidation.ok) {
      return { error: taxValidation.message };
    }
    updateSupplierProductData.igst_rate = taxValidation.data.igstRate;
    updateSupplierProductData.cgst_rate = taxValidation.data.cgstRate;
    updateSupplierProductData.sgst_rate = taxValidation.data.sgstRate;
  }

  const existingAttributes = supplierProduct.attributes || {};
  let updatedAttributes = { ...existingAttributes };
  if (reqBody.description !== undefined) {
    updatedAttributes = buildSupplierDescriptionAttributes(
      updatedAttributes,
      reqBody.description
    );
  }
  if (reqBody.name !== undefined) updatedAttributes.listingName = (reqBody.name || '').toString().trim();
  if (reqBody.brand !== undefined) {
    const nextBrand = (reqBody.brand || '').toString().trim();
    // Do not wipe an existing brand during image/inventory-only updates.
    if (nextBrand) updatedAttributes.brand = nextBrand;
  }
  if (reqBody.gtin !== undefined) {
    const g = normalizeGtin(reqBody.gtin || '');
    if (g && !isValidGtin(g)) {
      return { error: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.' };
    }
    updatedAttributes.gtin = g || null;
  }
  if (reqBody.mpn !== undefined) updatedAttributes.mpn = (reqBody.mpn || '').toString().trim();
  if (reqBody.specifications !== undefined) {
    updatedAttributes = syncOfferAttributesWithSpecifications({
      ...updatedAttributes,
      specifications: reqBody.specifications || existingAttributes.specifications || {}
    });
  }
  if (reqBody.brandModel !== undefined) {
    const nextBrandModel = (reqBody.brandModel || '').toString().trim();
    if (nextBrandModel) updatedAttributes.brandModel = nextBrandModel;
  }
  if (reqBody.lsa !== undefined) updatedAttributes.lsa = (reqBody.lsa || '').toString().trim();
  if (reqBody.hsnCode !== undefined || reqBody.hsn_code !== undefined) {
    const rawHsnCode = reqBody.hsnCode !== undefined ? reqBody.hsnCode : reqBody.hsn_code;
    updatedAttributes.hsnCode = (rawHsnCode || '').toString().trim();
  }
  if (reqBody.sku !== undefined || reqBody.skuNo !== undefined || reqBody.gsku !== undefined) {
    updatedAttributes.sku = (
      reqBody.skuNo !== undefined ? reqBody.skuNo : reqBody.sku !== undefined ? reqBody.sku : reqBody.gsku
    || '').toString().trim();
  }
  if (reqBody.packSize !== undefined || reqBody.pack_size !== undefined) {
    updatedAttributes.packSize = (
      reqBody.packSize !== undefined ? reqBody.packSize : reqBody.pack_size
    || '').toString().trim();
  }
  if (reqBody.unit !== undefined) {
    const nextUnit = (reqBody.unit || '').toString().trim();
    if (nextUnit) updatedAttributes.unit = nextUnit;
  }
  if (reqBody.images !== undefined) updatedAttributes.images = sanitizeImageUrls(reqBody.images);

  const nextSpecifications =
    reqBody.specifications !== undefined ? reqBody.specifications || {} : existingAttributes.specifications || {};
  const specificationsChanged = shouldMoveToPendingForSpecChange({
    specificationsProvided: reqBody.specifications !== undefined,
    currentSpecs: existingAttributes.specifications || {},
    nextSpecs: nextSpecifications || {}
  });

  if (Object.keys(updatedAttributes).length > 0) {
    if (taxFieldsProvided) {
      updatedAttributes.igstRate = updateSupplierProductData.igst_rate;
      updatedAttributes.cgstRate = updateSupplierProductData.cgst_rate;
      updatedAttributes.sgstRate = updateSupplierProductData.sgst_rate;
    }
    updateSupplierProductData.attributes = syncOfferAttributesWithSpecifications(updatedAttributes);
  }

  return {
    updateSupplierProductData,
    updatedAttributes,
    nextSpecifications,
    specificationsChanged
  };
}

export async function fetchAndValidateSupplierProductForUpdate(supabase, { id, reqUserId }) {
  const { data: supplierProduct, error: supplierProductError } = await supabase
    .from('supplier_products')
    .select('*')
    .eq('id', id)
    .eq('supplier_id', reqUserId)
    .maybeSingle();
  return { supplierProduct, supplierProductError };
}

export async function checkDuplicateSupplierVariant(
  supabase,
  { supplierProduct, reqUserId, candidateLocation, variantKey, currentId }
) {
  const { data: duplicateVariant } = await supabase
    .from('supplier_products')
    .select('id')
    .eq('product_id', supplierProduct.product_id)
    .eq('supplier_id', reqUserId)
    .eq('location', candidateLocation)
    .eq('variant_key', variantKey)
    .neq('id', currentId)
    .maybeSingle();
  return duplicateVariant;
}
