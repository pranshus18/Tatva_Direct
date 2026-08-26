import {
  buildDisambiguatedAsinLikeId,
  buildIdentityBundle,
  buildVariantAsinLikeId,
  isCurrentCatalogTsin,
  isCurrentVariantTsin
} from './productIdentityService.js';
import { isPgUniqueViolation } from '../utils/supplierOfferUniqueness.js';

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanIdentifier(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function catalogIdentityInputFromProduct(row = {}) {
  const specs = normalizeObject(row.specifications);
  return {
    name: row.name || '',
    category: row.category || '',
    unit: row.unit || '',
    brand: row.brand || specs.brand || specs.brandModel || '',
    gtin: cleanIdentifier(row.gtin || specs.gtin || specs.upc || specs.ean || ''),
    mpn: row.mpn || specs.mpn || specs.modelNumber || specs.model_no || '',
    packSize: specs.packSize || specs.pack_size || '',
    brandModel: specs.brandModel || '',
    specifications: specs
  };
}

export function nextCatalogTsin(product = {}, usedAsins = new Set()) {
  const desired = buildIdentityBundle(catalogIdentityInputFromProduct(product)).asinLikeId;
  if (!usedAsins.has(desired)) return desired;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const next = buildDisambiguatedAsinLikeId(desired, `${product.id || 'product'}:${attempt}`);
    if (!usedAsins.has(next)) return next;
  }
  return desired;
}

export async function persistCurrentCatalogTsin(supabase, product, usedAsins = new Set()) {
  const stored = String(product?.asin || '').trim().toUpperCase();
  if (!product?.id) return stored;
  if (isCurrentCatalogTsin(stored) && !usedAsins.has(stored)) {
    usedAsins.add(stored);
    return stored;
  }

  let next = nextCatalogTsin(product, usedAsins);
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    if (attempt > 0) {
      next = buildDisambiguatedAsinLikeId(next, `${product.id}:${attempt}`);
    }
    if (usedAsins.has(next) && next !== stored) continue;
    const { error } = await supabase.from('products').update({ asin: next }).eq('id', product.id);
    if (!error) {
      usedAsins.add(next);
      product.asin = next;
      return next;
    }
    if (!isPgUniqueViolation(error)) {
      console.warn('[TSIN upgrade] product asin update failed:', product.id, error.message || error);
      if (isCurrentCatalogTsin(stored)) usedAsins.add(stored);
      return stored;
    }
  }
  if (isCurrentCatalogTsin(stored)) usedAsins.add(stored);
  return stored;
}

export async function persistCurrentVariantTsin(supabase, offer, parentAsin) {
  const parent = String(parentAsin || '').trim().toUpperCase();
  const variantKey = String(offer?.variant_key || '').trim();
  const stored = String(offer?.variant_asin || '').trim().toUpperCase();
  if (!offer?.id || !parent || !variantKey) return stored;
  if (isCurrentVariantTsin(parent, stored)) return stored;

  const next = buildVariantAsinLikeId(parent, variantKey);
  const { error } = await supabase
    .from('supplier_products')
    .update({ variant_asin: next })
    .eq('id', offer.id);
  if (error) {
    console.warn('[TSIN upgrade] supplier_products variant_asin update failed:', offer.id, error.message || error);
    return stored;
  }
  offer.variant_asin = next;

  if (stored && stored !== next) {
    const { error: bcovError } = await supabase
      .from('supplier_bcov_levels')
      .update({ variant_asin: next })
      .eq('variant_asin', stored);
    if (bcovError && !/does not exist|schema cache/i.test(String(bcovError.message || ''))) {
      console.warn('[TSIN upgrade] bcov variant_asin remap failed:', stored, bcovError.message || bcovError);
    }
  }
  return next;
}

export async function persistCurrentProductVariantTsin(supabase, row, parentAsin) {
  const parent = String(parentAsin || '').trim().toUpperCase();
  const variantKey = String(row?.variant_key || '').trim();
  const stored = String(row?.variant_asin || '').trim().toUpperCase();
  if (!row?.id || !parent || !variantKey) return stored;
  if (isCurrentVariantTsin(parent, stored)) return stored;

  const next = buildVariantAsinLikeId(parent, variantKey);
  const { error } = await supabase
    .from('product_variants')
    .update({ variant_asin: next })
    .eq('id', row.id);
  if (error) {
    console.warn('[TSIN upgrade] product_variants variant_asin update failed:', row.id, error.message || error);
    return stored;
  }
  row.variant_asin = next;
  return next;
}

export async function upgradeSupplierInventoryTsins(supabase, supplierProducts = []) {
  const usedAsins = new Set();
  const productById = new Map();

  for (const sp of supplierProducts) {
    const product = sp?.product;
    if (!product?.id || productById.has(product.id)) continue;
    productById.set(product.id, product);
  }

  for (const product of productById.values()) {
    await persistCurrentCatalogTsin(supabase, product, usedAsins);
  }

  for (const sp of supplierProducts) {
    const parentAsin = sp?.product?.asin || '';
    await persistCurrentVariantTsin(supabase, sp, parentAsin);
  }
}
