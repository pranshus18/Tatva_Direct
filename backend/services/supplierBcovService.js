import { composeBcovNotes, toFiniteNumber } from './supplierCatalogHelpersService.js';
import { parseCovThresholdNumber } from './procurementSharedService.js';

/**
 * Catalog MRP from supplier_products for a variant (Manage Inventory).
 * @returns {Promise<number|null>}
 */
export async function fetchVariantCatalogMrp(supabase, supplierId, variantKey) {
  const key = String(variantKey || '').trim();
  if (!key || !supplierId) return null;

  const { data, error } = await supabase
    .from('supplier_products')
    .select('price')
    .eq('supplier_id', supplierId)
    .eq('variant_key', key)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  const mrp = Number(data[0]?.price);
  return Number.isFinite(mrp) && mrp >= 0 ? mrp : null;
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

  if (requireCatalogMrp && (catalogMrp === null || catalogMrp < 0)) {
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

    if (buyerPcov !== null) {
      if (buyerPcov < buyerCov) {
        return {
          ok: false,
          message: `Row ${i + 1}: PlatformCOV must be greater than or equal to Brand_cov`
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
      notes: composeBcovNotes({ levelName, buyerBcov })
    });
  }

  return { ok: true, levels: normalized };
}
