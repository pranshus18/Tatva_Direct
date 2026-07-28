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
  const isActive = product.is_active === true || product.isActive === true;
  const status =
    rawStatus === 'rejected'
      ? 'rejected'
      : rawStatus === 'approved' || rawStatus === 'active' || isActive
        ? 'approved'
        : 'pending';
  const rejectionReason = String(
    product.rejectionReason || product.rejection_reason || ''
  ).trim();
  return {
    ...product,
    ...(offerId ? { supplier_product_id: offerId } : {}),
    status,
    is_active: status === 'approved' ? true : Boolean(isActive),
    rejection_reason: rejectionReason || product.rejection_reason || null,
    rejectionReason: rejectionReason || null,
    price: parsedPrice != null ? parsedPrice : Number(product.price) || 0,
    stock: stock != null ? stock : 0,
    location: product.location == null ? '' : String(product.location),
    min_order_quantity: minOrder != null && minOrder > 0 ? minOrder : 1
  };
}

export function normalizeSupplierProductsFromApi(products) {
  if (!Array.isArray(products)) return [];
  return products.map(normalizeSupplierProductFromApi);
}

export function buildSupplierProductLookupMap(products) {
  const map = {};
  normalizeSupplierProductsFromApi(products).forEach((p) => {
    const id = getSupplierOfferRowId(p);
    if (id) map[id] = p;
  });
  return map;
}
