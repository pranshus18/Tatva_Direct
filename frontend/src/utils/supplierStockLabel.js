import { RUPEE_SYMBOL } from './formatRupee';

/** Supplier portal label for the logged-in supplier's on-hand quantity */
export const SUPPLIER_CURRENT_STOCK_LABEL = 'Current stock with you';

/** Shown until MRP / location inventory details are completed (step 2) */
export const SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL = 'Inventory Setup Pending';

/** Supplier portal label for catalog / inventory unit amount (API field remains `price`) */
export const SUPPLIER_MRP_LABEL = 'MRP';

/** Form column: MRP with rupee symbol */
export const SUPPLIER_MRP_FIELD_LABEL = `${SUPPLIER_MRP_LABEL} (${RUPEE_SYMBOL})`;

/** Product_COV tier unit price (must not exceed catalog MRP) */
export const SUPPLIER_COV_PRICE_LABEL = 'COV price';

/** Form column: COV price with rupee symbol */
export const SUPPLIER_COV_PRICE_FIELD_LABEL = `${SUPPLIER_COV_PRICE_LABEL} (${RUPEE_SYMBOL})`;

/**
 * True once inventory details (MRP and/or location) have been set.
 * Catalog-only offers default to price 0 and empty location until Manage Inventory.
 */
export function isSupplierInventoryConfigured(product) {
  if (!product) return false;
  const price = Number(product.price);
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasLocation = Boolean(String(product.location || '').trim());
  return hasPrice || hasLocation;
}

/** Catalog card stock line: "12 in stock" / "Out of stock". */
export function formatSupplierStockAvailability(stock) {
  const qty = Number(stock);
  if (!Number.isFinite(qty) || qty <= 0) return 'Out of stock';
  return `${qty} in stock`;
}

/** Parse offer MRP from API / form values. */
export function parseSupplierOfferPrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  const normalized = String(raw).trim().replace(/,/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/** True once a supplier offer has a saved MRP — only admin may change it afterward. */
export function isSupplierMrpLocked(product) {
  const price = parseSupplierOfferPrice(product?.price);
  return price !== null && price > 0;
}

export const SUPPLIER_MRP_LOCKED_MESSAGE =
  'MRP is locked after the first save. Contact admin if you need to change it.';