import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';

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
  let existingProduct = null;
  if (selectedCatalogProductId) {
    const { data: bySelectedId } = await supabase
      .from('products')
      .select('id, status, brand, gtin, barcode, name, category, asin, catalog_key, specifications')
      .eq('id', selectedCatalogProductId)
      .maybeSingle();
    if (bySelectedId) existingProduct = bySelectedId;
  }

  if (!existingProduct && canonicalProductFromIdentifier) existingProduct = canonicalProductFromIdentifier;
  if (!existingProduct && identityBundle.catalog.gtin) {
    const { data: byGtin } = await supabase
      .from('products')
      .select('*')
      .eq('gtin', identityBundle.catalog.gtin)
      .maybeSingle();
    if (byGtin) existingProduct = byGtin;
  }
  if (!existingProduct && identityBundle.catalog.brand && identityBundle.catalog.mpn) {
    const { data: byBrandMpn } = await supabase
      .from('products')
      .select('*')
      .eq('brand', identityBundle.catalog.brand)
      .eq('mpn', identityBundle.catalog.mpn)
      .maybeSingle();
    if (byBrandMpn) existingProduct = byBrandMpn;
  }
  if (!existingProduct && identityBundle.catalogKey) {
    const { data: byCatalogKey } = await supabase
      .from('products')
      .select('*')
      .eq('catalog_key', identityBundle.catalogKey)
      .maybeSingle();
    if (byCatalogKey) existingProduct = byCatalogKey;
  }
  if (!existingProduct && productName && categoryName) {
    const { data: productsByName, error: nameSearchError } = await supabase
      .from('products')
      .select('*')
      .eq('category', categoryName)
      .ilike('name', productNameRaw);
    if (!nameSearchError && productsByName?.length) {
      const exactMatch = productsByName.find((p) => normalizeText(p.name) === normalizeText(productNameRaw));
      existingProduct = exactMatch || productsByName[0];
    }
  }
  return existingProduct;
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
    catalog_key: identityBundle.catalogKey
  };
  if (resolvedBarcodeForPos) productData.barcode = resolvedBarcodeForPos;

  const { data: newProduct, error: createError } = await supabase
    .from('products')
    .insert(productData)
    .select()
    .single();
  if (createError) {
    return { error: createError };
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
  const updatedAttributes = { ...existingAttributes };
  if (reqBody.description !== undefined) {
    const supplierText = String(reqBody.description || '').trim();
    updatedAttributes.supplierDescription = supplierText;
    updatedAttributes.description = supplierText;
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
    updatedAttributes.specifications = reqBody.specifications || existingAttributes.specifications || {};
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
    updateSupplierProductData.attributes = updatedAttributes;
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
