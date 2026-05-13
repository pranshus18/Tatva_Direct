/**
 * PostgREST OR filter for embedded `supplier_products` on `products` queries.
 *
 * Mirrors the reconciliation in GET /api/supplier/products: when the shared
 * catalog row is approved, suppliers see pending/null-status offers as approved;
 * service-provider discovery must include the same listings.
 *
 * Parent query should still enforce `products.status = 'approved'`.
 */
export const LISTED_SUPPLIER_PRODUCTS_OR =
  'and(status.eq.approved,is_active.eq.true),status.eq.pending,status.is.null';

export const listedSupplierProductsFilterOptions = { foreignTable: 'supplier_products' };
