import { parseSupplierStockQuantity } from './parseSupplierStockQuantity';

/**
 * Supplier catalog rows: one shared products.id (TSIN) per family, one supplier_products.id per variant offer.
 */
export function getSupplierOfferRowId(product) {
  if (!product) return null;
  const id = product.supplier_product_id || product.supplierProductId;
  return id ? String(id) : null;
}

/** Match list rows when applying PUT/DELETE results — never use catalog products.id alone when an offer id exists. */
export function matchSupplierOfferRow(product, rowId) {
  if (!product || !rowId) return false;
  const target = String(rowId);
  const offerId = getSupplierOfferRowId(product);
  if (offerId) return offerId === target;
  return String(product.id || product._id || '') === target;
}

export function findSupplierOfferRow(products, rowId) {
  if (!Array.isArray(products) || !rowId) return null;
  return products.find((p) => matchSupplierOfferRow(p, rowId)) || null;
}

/** Normalize API list rows for inventory/upstream UI (per-variant stock + offer id). */
export function normalizeSupplierProductFromApi(product) {
  if (!product) return product;
  const offerId = getSupplierOfferRowId(product);
  const stock = parseSupplierStockQuantity(product.stock);
  const minOrder = parseSupplierStockQuantity(product.min_order_quantity);
  const parsedPrice = (() => {
    if (product.price === undefined || product.price === null || product.price === '') return null;
    if (typeof product.price === 'number') {
      return Number.isFinite(product.price) ? product.price : null;
    }
    const normalized = String(product.price).trim().replace(/,/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  })();
  const rawStatus = String(product.status || 'pending').trim().toLowerCase();
  // Approval is the status string — never promote pending solely because is_active is true
  // (catalog products default is_active=true while still awaiting admin review).
  const status =
    rawStatus === 'rejected'
      ? 'rejected'
      : rawStatus === 'approved' || rawStatus === 'active'
        ? 'approved'
        : 'pending';
  const isActive =
    status === 'approved'
      ? product.is_active !== false && product.isActive !== false
      : false;
  const rejectionReason = String(
    product.rejectionReason || product.rejection_reason || ''
  ).trim();
  // Offer rows: never borrow catalog price. Preserve null/unset instead of fake ₹0.
  const resolvedPrice =
    offerId
      ? parsedPrice
      : parsedPrice != null
        ? parsedPrice
        : Number.isFinite(Number(product.price))
          ? Number(product.price)
          : null;
  return {
    ...product,
    ...(offerId ? { supplier_product_id: offerId } : {}),
    status,
    is_active: isActive,
    rejection_reason: rejectionReason || product.rejection_reason || null,
    rejectionReason: rejectionReason || null,
    price: resolvedPrice,
    stock: stock != null ? stock : 0,
    location: product.location == null ? '' : String(product.location),
    min_order_quantity: minOrder != null && minOrder > 0 ? minOrder : 1
  };
}

export function normalizeSupplierProductsFromApi(products) {
  if (!Array.isArray(products)) return [];
  return products.map(normalizeSupplierProductFromApi);
}

/** Normalized approval status for supplier offer rows (pending / approved / rejected). */
export function getSupplierOfferApprovalStatus(product) {
  return normalizeSupplierProductFromApi(product).status;
}

/** Trim upstream / offer id keys for consistent map lookups. */
export function normalizeSupplierProductKey(value) {
  return String(value ?? '').trim();
}

/** Approved active offers only — rejected/pending products stay on manage catalog, not upstream sourcing. */
export function isSupplierProductEligibleForUpstream(product) {
  const status = String(product?.status || 'pending').trim().toLowerCase();
  if (status === 'rejected') return false;
  if (status === 'approved' || status === 'active') {
    return product?.is_active !== false && product?.isActive !== false;
  }
  return false;
}

export function filterSupplierProductsForUpstream(products) {
  return normalizeSupplierProductsFromApi(products).filter(isSupplierProductEligibleForUpstream);
}

export function buildSupplierProductLookupMap(products) {
  const map = {};
  normalizeSupplierProductsFromApi(products).forEach((p) => {
    const id = getSupplierOfferRowId(p);
    if (id) map[id] = p;
  });
  return map;
}
