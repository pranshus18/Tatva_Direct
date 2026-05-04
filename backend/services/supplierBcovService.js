import { composeBcovNotes, normalizeBcovBrand, toFiniteNumber } from './supplierCatalogHelpersService.js';

export function validateAndNormalizeBcovLevels(levelsRaw = []) {
  if (!Array.isArray(levelsRaw)) {
    return { ok: false, message: 'levels must be an array' };
  }
  if (levelsRaw.length > 500) {
    return { ok: false, message: 'Maximum 500 BCOV rows allowed per save' };
  }

  const normalized = [];
  for (let i = 0; i < levelsRaw.length; i += 1) {
    const row = levelsRaw[i] || {};
    const brand = String(row.brand || '').trim();
    const normalizedBrand = normalizeBcovBrand(brand);
    const buyerCov = toFiniteNumber(row.buyerCov !== undefined ? row.buyerCov : row.minPurchaseQty);
    const price = toFiniteNumber(row.price);
    const buyerPcovRaw = row.buyerPcov !== undefined ? row.buyerPcov : row.maxPurchaseQty;
    const buyerPcov =
      buyerPcovRaw === null || buyerPcovRaw === undefined || String(buyerPcovRaw).trim() === ''
        ? null
        : toFiniteNumber(buyerPcovRaw);

    if (!brand || !normalizedBrand) {
      return { ok: false, message: `Row ${i + 1}: brand is required` };
    }
    if (brand.length > 120) {
      return { ok: false, message: `Row ${i + 1}: brand must be <= 120 characters` };
    }
    if (buyerCov === null || buyerCov < 0) {
      return { ok: false, message: `Row ${i + 1}: Brand_cov must be 0 or more` };
    }
    if (price === null || price < 0) {
      return { ok: false, message: `Row ${i + 1}: price must be 0 or more` };
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

    normalized.push({
      id: row.id || null,
      brand,
      normalizedBrand,
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
