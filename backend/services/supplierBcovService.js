import { composeBcovNotes, parseBcovNotes, toFiniteNumber } from './supplierCatalogHelpersService.js';
import { parseCovThresholdNumber } from './procurementSharedService.js';
import { fetchCanonicalVariantMrp } from './variantMrpService.js';
import { validateSupplierInventoryUpdateFields } from './supplierProductUpdateValidation.js';

export const INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE =
  'Inventory completion is required before Product COV. Complete all mandatory Inventory details in Manage Inventory, then try again.';

/** Product_COV requires a completed Manage Inventory save (MRP > 0, stock, location, GST). */
export function getProductCovInventoryMissingFields(offer = {}) {
  const attrs =
    offer?.attributes && typeof offer.attributes === 'object' && !Array.isArray(offer.attributes)
      ? offer.attributes
      : {};
  const inventoryCheck = validateSupplierInventoryUpdateFields({
    price: offer?.price,
    stock: offer?.stock,
    igst_rate: offer?.igst_rate ?? attrs.igstRate ?? attrs.igst_rate,
    cgst_rate: offer?.cgst_rate ?? attrs.cgstRate ?? attrs.cgst_rate,
    sgst_rate: offer?.sgst_rate ?? attrs.sgstRate ?? attrs.sgst_rate
  });
  const missing = [];
  const priceNum = Number(offer?.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    missing.push('MRP (incl. GST)');
  }
  if (inventoryCheck.missingFields.includes('stock')) {
    missing.push('Current stock with you');
  }
  if (!String(offer?.location || attrs.location || '').trim()) {
    missing.push('Location');
  }
  if (inventoryCheck.missingFields.some((field) => /sgst/i.test(String(field)))) {
    missing.push('SGST');
  }
  if (inventoryCheck.missingFields.some((field) => /cgst/i.test(String(field)))) {
    missing.push('CGST');
  }
  if (inventoryCheck.missingFields.some((field) => /igst/i.test(String(field)))) {
    missing.push('IGST');
  }
  return [...new Set(missing)];
}

export function formatInventoryRequiredForProductCovMessage(missingFields = []) {
  const missing = Array.isArray(missingFields) ? missingFields.filter(Boolean) : [];
  if (missing.length === 0) return INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE;
  return `Inventory completion is required before Product COV. Please complete: ${missing.join(', ')}.`;
}

export function evaluateProductCovInventoryGate(offer = {}) {
  const missing = getProductCovInventoryMissingFields(offer);
  if (missing.length === 0) {
    return { ok: true, message: '', missingFields: [] };
  }
  return {
    ok: false,
    missingFields: missing,
    message: formatInventoryRequiredForProductCovMessage(missing)
  };
}

/**
 * Catalog MRP from supplier_products for a variant (Manage Inventory).
 * Uses the canonical variant MRP shared across all suppliers when productId is known.
 * @returns {Promise<number|null>}
 */
export async function fetchVariantCatalogMrp(supabase, supplierId, variantKey, productId = null) {
  const key = String(variantKey || '').trim();
  if (!key || !supplierId) return null;

  const normalizedProductId = String(productId || '').trim();
  if (normalizedProductId) {
    const canonical = await fetchCanonicalVariantMrp(supabase, {
      productId: normalizedProductId,
      variantKey: key
    });
    if (canonical !== null) return canonical;
  }

  let query = supabase
    .from('supplier_products')
    .select('price')
    .eq('supplier_id', supplierId)
    .eq('variant_key', key)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (normalizedProductId) {
    query = query.eq('product_id', normalizedProductId);
  }

  const { data, error } = await query;

  if (error || !Array.isArray(data) || data.length === 0) return null;
  const mrp = Number(data[0]?.price);
  return Number.isFinite(mrp) && mrp >= 0 ? mrp : null;
}

/**
 * Whether this supplier offer may configure Product_COV / pricing levels.
 * Rejected offers must be corrected and re-approved first.
 */
export async function resolveVariantProductCovEligibility(supabase, supplierId, variantKey) {
  const key = String(variantKey || '').trim();
  if (!key || !supplierId) {
    return {
      eligible: false,
      status: 'missing',
      message: 'No product variant selected for Product_COV.'
    };
  }

  const { data, error } = await supabase
    .from('supplier_products')
    .select('id, status, is_active, price, stock, location, igst_rate, cgst_rate, sgst_rate, attributes')
    .eq('supplier_id', supplierId)
    .eq('variant_key', key)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    return {
      eligible: false,
      status: 'unknown',
      message: 'Could not verify product approval status for Product_COV.'
    };
  }

  const offer = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!offer) {
    return {
      eligible: false,
      status: 'missing',
      message: 'No supplier offer found for this variant.'
    };
  }

  const status = String(offer.status || '').trim().toLowerCase();
  if (status === 'rejected') {
    return {
      eligible: false,
      status: 'rejected',
      message:
        'This product is rejected. Correct it and wait for admin approval before configuring Product_COV.'
    };
  }

  const inventoryGate = evaluateProductCovInventoryGate(offer);
  if (!inventoryGate.ok) {
    return {
      eligible: false,
      status: 'inventory_incomplete',
      message: inventoryGate.message
    };
  }

  return {
    eligible: true,
    status: status || (offer.is_active ? 'approved' : 'pending'),
    message: ''
  };
}

export function validateAndNormalizeBcovLevels(levelsRaw = [], options = {}) {
  const catalogMrp =
    options.catalogMrp === null || options.catalogMrp === undefined
      ? null
      : toFiniteNumber(options.catalogMrp);
  const requireCatalogMrp = options.requireCatalogMrp === true;
  if (!Array.isArray(levelsRaw)) {
    return { ok: false, message: 'levels must be an array' };
  }
  if (levelsRaw.length > 500) {
    return { ok: false, message: 'Maximum 500 BCOV rows allowed per save' };
  }

  if (requireCatalogMrp && levelsRaw.length > 0 && (catalogMrp === null || catalogMrp < 0)) {
    return {
      ok: false,
      message:
        'Set catalog MRP for this variant in Manage Inventory before saving Product_COV levels.'
    };
  }

  const normalized = [];
  for (let i = 0; i < levelsRaw.length; i += 1) {
    const row = levelsRaw[i] || {};
    const variantKey = String(row.variantKey || '').trim();
    const variantAsin = String(row.variantAsin || '').trim() || null;
    const variantName = String(row.variantName || '').trim() || null;

    const buyerCov = toFiniteNumber(row.buyerCov !== undefined ? row.buyerCov : row.minPurchaseQty);
    const price = toFiniteNumber(row.price);
    const buyerPcovRaw = row.buyerPcov !== undefined ? row.buyerPcov : row.maxPurchaseQty;
    const buyerPcov =
      buyerPcovRaw === null || buyerPcovRaw === undefined || String(buyerPcovRaw).trim() === ''
        ? null
        : toFiniteNumber(buyerPcovRaw);

    if (!variantKey) {
      return { ok: false, message: `Row ${i + 1}: variant is required` };
    }
    if (variantKey.length > 128) {
      return { ok: false, message: `Row ${i + 1}: variantKey must be <= 128 characters` };
    }
    if (buyerCov === null || buyerCov < 0) {
      return { ok: false, message: `Row ${i + 1}: Brand_cov must be 0 or more` };
    }
    if (price === null || price < 0) {
      return { ok: false, message: `Row ${i + 1}: price must be 0 or more` };
    }
    if (catalogMrp !== null && price > catalogMrp) {
      return {
        ok: false,
        message: `Row ${i + 1}: COV price (₹${price}) cannot be higher than catalog MRP (₹${catalogMrp}).`
      };
    }
    if (buyerPcov !== null && buyerPcov < 0) {
      return {
        ok: false,
        message: `Row ${i + 1}: PlatformCOV must be 0 or more`
      };
    }

    const levelName = String(row.levelName || '').trim();
    const buyerBcov = String(row.buyerBcov ?? row.notes ?? '').trim();
    if (!levelName) {
      return { ok: false, message: `Row ${i + 1}: levelName is required` };
    }
    if (!buyerBcov) {
      return { ok: false, message: `Row ${i + 1}: Supplier_purchase_total is required` };
    }

    const supplierCovThreshold = parseCovThresholdNumber(buyerBcov);
    if (supplierCovThreshold === null || supplierCovThreshold < 0) {
      return {
        ok: false,
        message: `Row ${i + 1}: Supplier_purchase_total must be 0 or more`
      };
    }

    if (buyerCov >= supplierCovThreshold) {
      return {
        ok: false,
        message: `Row ${i + 1}: Brand_cov must be less than Supplier_COV`
      };
    }

    if (buyerPcov !== null) {
      if (buyerCov === buyerPcov) {
        return {
          ok: false,
          message: `Row ${i + 1}: Brand_cov must not be equal to Platform_COV`
        };
      }
      if (buyerCov >= buyerPcov) {
        return {
          ok: false,
          message: `Row ${i + 1}: Brand_cov must be less than Platform_COV`
        };
      }
      if (buyerPcov < supplierCovThreshold) {
        return {
          ok: false,
          message: `Row ${i + 1}: PlatformCOV must be greater than or equal to Supplier_purchase_total`
        };
      }
    }

    normalized.push({
      id: row.id || null,
      variantKey,
      variantAsin,
      variantName,
      minPurchaseQty: buyerCov,
      maxPurchaseQty: buyerPcov,
      price,
      levelName,
      buyerBcov,
      supplierProductId: String(row.supplierProductId || '').trim() || null,
      notes: composeBcovNotes({
        levelName,
        buyerBcov,
        supplierProductId: row.supplierProductId
      })
    });
  }

  return { ok: true, levels: normalized };
}

/**
 * Hard-delete Product_COV rows for a supplier + variant_key.
 * Used when the supplier no longer has any live offer for that variant.
 */
export async function deleteSupplierBcovLevelsForVariant(supabase, { supplierId, variantKey }) {
  const sid = String(supplierId || '').trim();
  const key = String(variantKey || '').trim();
  if (!sid || !key) {
    return { deleted: false, reason: 'missing_ids' };
  }

  const { error } = await supabase
    .from('supplier_bcov_levels')
    .delete()
    .eq('supplier_id', sid)
    .eq('variant_key', key);

  if (error) throw error;
  return { deleted: true, supplierId: sid, variantKey: key };
}

/**
 * Delete Product_COV for supplier+variant only when no supplier_products offer remains.
 * Keeps COV intact when another location/offer still shares the same variant_key.
 */
export async function deleteSupplierBcovLevelsIfNoRemainingOffer(
  supabase,
  { supplierId, variantKey }
) {
  const sid = String(supplierId || '').trim();
  const key = String(variantKey || '').trim();
  if (!sid || !key) {
    return { deleted: false, reason: 'missing_ids' };
  }

  const { count, error: countError } = await supabase
    .from('supplier_products')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', sid)
    .eq('variant_key', key);

  if (countError) throw countError;
  if ((count || 0) > 0) {
    return { deleted: false, reason: 'offer_still_present', remainingOffers: count };
  }

  return deleteSupplierBcovLevelsForVariant(supabase, { supplierId: sid, variantKey: key });
}

/**
 * Clear orphaned Product_COV rows for many (supplierId, variantKey) pairs from deleted offers.
 * Dedupes pairs and only removes COV when that supplier has no remaining offer for the key.
 */
export async function deleteSupplierBcovLevelsForDeletedOffers(supabase, offerRows = []) {
  const pairs = new Map();
  for (const row of offerRows || []) {
    const supplierId = String(row?.supplier_id || '').trim();
    const variantKey = String(row?.variant_key || '').trim();
    if (!supplierId || !variantKey) continue;
    pairs.set(`${supplierId}::${variantKey}`, { supplierId, variantKey });
  }

  const results = [];
  for (const pair of pairs.values()) {
    results.push(await deleteSupplierBcovLevelsIfNoRemainingOffer(supabase, pair));
  }
  return results;
}

/**
 * When a supplier starts a fresh listing for a variant_key (no prior offer rows),
 * wipe any leftover Product_COV from a previously deleted product/variant.
 */
export async function clearOrphanedSupplierBcovLevelsBeforeNewOffer(
  supabase,
  { supplierId, variantKey }
) {
  return deleteSupplierBcovLevelsIfNoRemainingOffer(supabase, { supplierId, variantKey });
}

/**
 * Decide whether a stored Product_COV row belongs to the current supplier offer.
 * Product_COV is supplier-owned and per-variant; deleted listings must not refill a new offer.
 */
export function isBcovLevelOwnedByOffer(level, offer, { siblingOfferCount = 1 } = {}) {
  if (!level || !offer) return false;
  const offerId = String(offer.id || '').trim();
  const parsed = parseBcovNotes(level.notes);
  const taggedOfferId = String(parsed.supplierProductId || '').trim();

  if (taggedOfferId) {
    return taggedOfferId === offerId;
  }

  // Multiple live locations still share untagged legacy slabs for the same variant_key.
  if (siblingOfferCount > 1) return true;

  const offerCreatedMs = Date.parse(String(offer.created_at || ''));
  const levelUpdatedMs = Date.parse(String(level.updated_at || level.created_at || ''));
  if (!Number.isFinite(offerCreatedMs) || !Number.isFinite(levelUpdatedMs)) {
    // Without timestamps, never show untagged leftovers on a single fresh offer.
    return false;
  }
  // Allow a small clock skew; anything clearly older than this listing is leftover.
  return levelUpdatedMs >= offerCreatedMs - 5000;
}

/**
 * Keep only Product_COV rows for this supplier offer / live variant generation.
 * Optionally deletes rejected leftover rows from deleted products/variants.
 */
export async function selectBcovLevelsForSupplierOffer(
  supabase,
  { supplierId, variantKey, supplierProductId = null, purgeStale = true } = {}
) {
  const sid = String(supplierId || '').trim();
  const key = String(variantKey || '').trim();
  if (!sid || !key) {
    return { levels: [], offer: null, siblingOfferCount: 0 };
  }

  let offerQuery = supabase
    .from('supplier_products')
    .select('id, variant_key, created_at, updated_at, status')
    .eq('supplier_id', sid)
    .eq('variant_key', key)
    .order('updated_at', { ascending: false });

  const offerId = String(supplierProductId || '').trim();
  if (offerId) {
    offerQuery = supabase
      .from('supplier_products')
      .select('id, variant_key, created_at, updated_at, status')
      .eq('supplier_id', sid)
      .eq('id', offerId)
      .maybeSingle();
  } else {
    offerQuery = offerQuery.limit(1).maybeSingle();
  }

  const { data: offer, error: offerError } = await offerQuery;
  if (offerError) throw offerError;
  if (!offer?.id) {
    return { levels: [], offer: null, siblingOfferCount: 0 };
  }

  if (String(offer.variant_key || '').trim() && String(offer.variant_key).trim() !== key) {
    return { levels: [], offer, siblingOfferCount: 0 };
  }

  const { count: siblingOfferCount, error: countError } = await supabase
    .from('supplier_products')
    .select('id', { count: 'exact', head: true })
    .eq('supplier_id', sid)
    .eq('variant_key', key);
  if (countError) throw countError;

  const { data: rows, error: levelsError } = await supabase
    .from('supplier_bcov_levels')
    .select(
      'id, variant_key, variant_asin, variant_name, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes, created_at, updated_at'
    )
    .eq('supplier_id', sid)
    .eq('variant_key', key)
    .order('min_purchase_qty', { ascending: true });
  if (levelsError) throw levelsError;

  const allLevels = rows || [];
  const ownedLevels = allLevels.filter((level) =>
    isBcovLevelOwnedByOffer(level, offer, { siblingOfferCount: siblingOfferCount || 0 })
  );

  if (purgeStale) {
    const ownedIds = new Set(ownedLevels.map((row) => row.id));
    const staleIds = allLevels.map((row) => row.id).filter((id) => id && !ownedIds.has(id));
    if (staleIds.length > 0) {
      const { error: purgeError } = await supabase
        .from('supplier_bcov_levels')
        .delete()
        .eq('supplier_id', sid)
        .in('id', staleIds);
      if (purgeError) {
        console.error(
          '[Product_COV] failed to purge stale levels for offer:',
          purgeError?.message || purgeError
        );
      }
    }
  }

  return {
    levels: ownedLevels,
    offer,
    siblingOfferCount: siblingOfferCount || 0
  };
}
