import { RUPEE_SYMBOL } from './formatRupee';
import { parseSupplierStockQuantity } from './parseSupplierStockQuantity';

/** Supplier portal label for the logged-in supplier's on-hand quantity */
export const SUPPLIER_CURRENT_STOCK_LABEL = 'Current stock with you';

/** Shown until MRP inventory details are completed (step 2) */
export const SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL = 'Inventory Setup Pending';

/** Supplier portal label for catalog / inventory unit amount (API field remains `price`; GST-inclusive MRP) */
export const SUPPLIER_MRP_LABEL = 'MRP (incl. GST)';

/** Form column: MRP with rupee symbol */
export const SUPPLIER_MRP_FIELD_LABEL = `${SUPPLIER_MRP_LABEL} (${RUPEE_SYMBOL})`;

/** Product_COV purchase thresholds (rupee amounts, same unit as COV price) */
export const SUPPLIER_COV_LABEL = 'Supplier_COV';
export const BRAND_COV_LABEL = 'Brand_cov';
export const PLATFORM_COV_LABEL = 'Platform_COV';

export const SUPPLIER_COV_FIELD_LABEL = `${SUPPLIER_COV_LABEL} (${RUPEE_SYMBOL})`;
export const BRAND_COV_FIELD_LABEL = `${BRAND_COV_LABEL} (${RUPEE_SYMBOL})`;
export const PLATFORM_COV_FIELD_LABEL = `${PLATFORM_COV_LABEL} (${RUPEE_SYMBOL})`;

/** Product_COV tier unit price (must not exceed catalog MRP; also GST-inclusive) */
export const SUPPLIER_COV_PRICE_LABEL = 'COV price (incl. GST)';

/** Shown under MRP / price fields in supplier inventory forms */
export const SUPPLIER_MRP_INCLUSIVE_HINT =
  'This is the final price buyers pay. It already includes the base price and GST — do not add GST separately.';

/** Form column: COV price with rupee symbol */
export const SUPPLIER_COV_PRICE_FIELD_LABEL = `${SUPPLIER_COV_PRICE_LABEL} (${RUPEE_SYMBOL})`;

/**
 * True once inventory MRP has been set.
 * Catalog-only offers default to price 0 until Manage Inventory.
 */
export function isSupplierInventoryConfigured(product) {
  if (!product) return false;
  const price = Number(product.price);
  return Number.isFinite(price) && price > 0;
}

/** Catalog card stock line: "12 in stock" / "Out of stock". */
export function formatSupplierStockAvailability(stock) {
  const qty = Number(stock);
  if (!Number.isFinite(qty) || qty <= 0) return 'Out of stock';
  return `${qty} in stock`;
}

/** Parse supplier-defined LSA (Low Stock Alert) threshold — whole units only. */
export function parseSupplierLsaThreshold(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const lsa = parseInt(String(raw).trim(), 10);
  return Number.isFinite(lsa) && lsa > 0 ? lsa : null;
}

/**
 * Stock health for supplier catalog cards: out / low / ok.
 * "Low" uses the variant LSA when set; no LSA means stock above zero is ok.
 */
export function getSupplierStockHealth({ stock, lsa } = {}) {
  const quantity = parseSupplierStockQuantity(stock);
  if (quantity === null || quantity <= 0) return 'out';

  const lsaThreshold = parseSupplierLsaThreshold(lsa);
  if (lsaThreshold != null && quantity <= lsaThreshold) return 'low';

  return 'ok';
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

/** True when another supplier has already set the canonical MRP for this variant. */
export function isVariantMrpEnforced(product) {
  const canonical = parseSupplierOfferPrice(product?.canonicalMrp);
  return canonical !== null && canonical > 0;
}

export function getCanonicalVariantMrp(product) {
  return parseSupplierOfferPrice(product?.canonicalMrp);
}

export function formatVariantMrpFixedMessage(canonicalMrp) {
  const amount = parseSupplierOfferPrice(canonicalMrp);
  if (amount === null) {
    return 'MRP for this variant is fixed for all suppliers. Contact admin to change it.';
  }
  return `MRP for this variant is fixed at ${RUPEE_SYMBOL}${amount.toFixed(2)} for all suppliers. Contact admin to change it.`;
}

/** Supplier may not edit MRP when their own offer is locked or the variant MRP is already set. */
export function isSupplierMrpInputDisabled(product) {
  return isSupplierMrpLocked(product) || isVariantMrpEnforced(product);
}

function isSupplierOfferApproved(product) {
  const status = String(product?.status || product?.offerStatus || '').trim().toLowerCase();
  return status === 'approved' || status === 'active';
}

function parseStoredHsnCode(product) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  return String(product?.hsnCode || product?.hsn_code || attrs.hsnCode || attrs.hsn_code || '').replace(
    /\D/g,
    ''
  );
}

function parseStoredGtin(product) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  return String(product?.gtin || attrs.gtin || '').replace(/\s+/g, '').trim();
}

function parseStoredTaxRate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
}

function hasStoredGstRates(product) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  const igst = parseStoredTaxRate(product?.igst_rate ?? product?.igstRate ?? attrs.igstRate);
  const cgst = parseStoredTaxRate(product?.cgst_rate ?? product?.cgstRate ?? attrs.cgstRate);
  const sgst = parseStoredTaxRate(product?.sgst_rate ?? product?.sgstRate ?? attrs.sgstRate);
  return igst !== null && cgst !== null && sgst !== null;
}

/** True after an approved offer already has an HSN code. */
export function isSupplierHsnLocked(product) {
  return Boolean(product) && isSupplierOfferApproved(product) && Boolean(parseStoredHsnCode(product));
}

/** True after an approved offer already has GST rates. */
export function isSupplierGstLocked(product) {
  return Boolean(product) && isSupplierOfferApproved(product) && hasStoredGstRates(product);
}

/** True after an approved offer already has a GTIN / UPC / EAN. */
export function isSupplierGtinLocked(product) {
  return Boolean(product) && isSupplierOfferApproved(product) && Boolean(parseStoredGtin(product));
}

export const SUPPLIER_HSN_LOCKED_MESSAGE =
  'HSN code is locked after approval. Contact admin if you need to change it.';
export const SUPPLIER_GST_LOCKED_MESSAGE =
  'GST rates are locked after approval. Contact admin if you need to change them.';
export const SUPPLIER_GTIN_LOCKED_MESSAGE =
  'GTIN / UPC / EAN is locked after approval. Contact admin if you need to change it.';