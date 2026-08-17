const EMPTY_LOCATION_ALIASES = new Set(['', 'not specified', 'n/a', 'na', 'none']);

export const DUPLICATE_SUPPLIER_VARIANT_MESSAGE =
  'You have already added this exact product variation for this location. Please update the existing entry instead.';

export function normalizeSupplierOfferLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function supplierOfferLocationsMatch(left, right) {
  const a = normalizeSupplierOfferLocation(left);
  const b = normalizeSupplierOfferLocation(right);
  const emptyA = EMPTY_LOCATION_ALIASES.has(a);
  const emptyB = EMPTY_LOCATION_ALIASES.has(b);
  if (emptyA && emptyB) return true;
  return a === b;
}

export function findOwnOfferForVariantLocation(
  offers = [],
  { supplierId, location, variantKey } = {}
) {
  const key = String(variantKey || '').trim();
  if (!key) return null;
  return (
    (offers || []).find(
      (row) =>
        String(row?.supplier_id) === String(supplierId) &&
        String(row?.variant_key || '').trim() === key &&
        supplierOfferLocationsMatch(row?.location, location)
    ) || null
  );
}

export function isExistingOfferUpdatableOnCreate(row) {
  const status = String(row?.status || '').toLowerCase();
  return status === 'pending' || status === 'rejected';
}

export function isSupplierOfferUniqueViolation(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  const details = String(error.details || '');
  const constraint = String(error.constraint || '');
  if (code !== '23505' && !/duplicate key value violates unique constraint/i.test(message)) {
    return false;
  }
  const haystack = `${message} ${details} ${constraint}`;
  return (
    /supplier_products/i.test(haystack) ||
    /product_supplier_location_variant/i.test(haystack) ||
    /uq_supplier_offer_variant_outlet/i.test(haystack)
  );
}
