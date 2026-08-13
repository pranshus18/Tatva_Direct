import { formatRupee, formatRupeePerUnit, parseMoney } from './formatRupee';

/**
 * Normalize discovery/detail price fields for Product_COV display.
 * No Product_COV unlock → MRP/list price only (never show a crossed-out "deal").
 */
export function resolveDiscoveryDisplayPricing(source = {}) {
  const rawPrice = parseMoney(source?.price);
  const mrp = parseMoney(source?.mrp ?? source?.basePrice);
  const bcovApplied =
    source?.bcovApplied === true &&
    rawPrice > 0 &&
    mrp > rawPrice;

  if (!bcovApplied) {
    const listPrice =
      mrp > 0 ? mrp : rawPrice > 0 ? rawPrice : null;
    return {
      price: listPrice,
      mrp: listPrice,
      bcovApplied: false
    };
  }

  return {
    price: rawPrice,
    mrp,
    bcovApplied: true
  };
}

export function formatDiscoveryPrice(price, unit) {
  const num = parseMoney(price);
  if (!(num > 0)) return null;
  return formatRupeePerUnit(num, unit, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatDiscoveryMrp(mrp) {
  const num = parseMoney(mrp);
  if (!(num > 0)) return null;
  return formatRupee(num, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
