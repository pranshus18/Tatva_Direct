const EMPTY_LOCATION_ALIASES = new Set(['', 'not specified', 'n/a', 'na', 'none']);

export const DUPLICATE_SUPPLIER_VARIANT_MESSAGE =
  'You have already added this exact product variation for this location. Please update the existing entry instead.';

export const GENERIC_SUPPLIER_PRODUCT_WRITE_MESSAGE =
  'Could not save this product. Please try again.';

export const DUPLICATE_CATALOG_PRODUCT_MESSAGE =
  'A product with this identity already exists. Open that listing and update it instead of creating a duplicate.';

const OWN_OFFER_SELECT =
  'id, supplier_id, location, outlet_id, status, is_active, variant_key, variant_asin, attributes';

export function normalizeSupplierOfferLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function canonicalSupplierOfferLocation(value) {
  const normalized = normalizeSupplierOfferLocation(value);
  if (!normalized || EMPTY_LOCATION_ALIASES.has(normalized)) return '';
  return String(value || '').trim();
}

export function supplierOfferLocationsMatch(left, right) {
  const a = canonicalSupplierOfferLocation(left);
  const b = canonicalSupplierOfferLocation(right);
  if (!a && !b) return true;
  return normalizeSupplierOfferLocation(a) === normalizeSupplierOfferLocation(b);
}

export function collectErrorHaystack(error) {
  if (error == null) return '';
  if (typeof error === 'string' || typeof error === 'number') return String(error);

  const parts = [];
  const seen = new Set();

  const push = (value) => {
    if (value == null) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      if (text) parts.push(text);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof Error) {
      push(value.message);
      push(value.code);
      push(value.details);
      push(value.hint);
      push(value.constraint);
      push(value.name);
      if (value.cause) push(value.cause);
      return;
    }

    for (const key of ['message', 'details', 'hint', 'code', 'constraint', 'error', 'cause', 'msg']) {
      if (value[key] != null) push(value[key]);
    }
  };

  push(error);
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') parts.push(serialized);
  } catch {
    // PostgREST / Error objects may not serialize cleanly.
  }
  return parts.join(' ');
}

export function isPgUniqueViolation(error) {
  if (!error) return false;
  const haystack = collectErrorHaystack(error);
  const code = String(error?.code || '');
  return (
    code === '23505' ||
    /23505/.test(haystack) ||
    /duplicate key value violates unique constraint/i.test(haystack) ||
    /violates unique constraint/i.test(haystack)
  );
}

export function looksLikePostgresConstraintError(errorOrMessage) {
  const haystack =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : collectErrorHaystack(errorOrMessage);
  return /duplicate key value violates unique constraint|violates unique constraint|23505/i.test(
    haystack
  );
}

export function isCatalogProductUniqueViolation(error) {
  if (!isPgUniqueViolation(error)) return false;
  const haystack = collectErrorHaystack(error);
  return (
    /uq_products_/i.test(haystack) ||
    /idx_products_(gtin|asin|barcode|catalog_key|brand_mpn)/i.test(haystack) ||
    /products_.*_(gtin|asin|barcode|catalog_key|brand_mpn)/i.test(haystack) ||
    /catalog_key_not_blank/i.test(haystack)
  );
}

/** Parse `Key (barcode)=(ABC) already exists.` from a Postgres unique violation. */
export function parsePgUniqueViolationIdentity(error) {
  const haystack = collectErrorHaystack(error);
  const match = haystack.match(/Key \(([^)]+)\)=\(([\s\S]*?)\) already exists/i);
  if (!match) return null;
  const column = String(match[1] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const value = String(match[2] || '').trim();
  if (!column) return null;
  return { column, value };
}

export function isSupplierOfferUniqueViolation(error) {
  if (!isPgUniqueViolation(error)) return false;
  const haystack = collectErrorHaystack(error);
  if (
    /supplier_products/i.test(haystack) ||
    /product_supplier_location/i.test(haystack) ||
    /uq_supplier_offer_variant_outlet/i.test(haystack) ||
    /location_variant/i.test(haystack)
  ) {
    return true;
  }
  // PostgREST often puts only the key tuple in `details` and omits the table name.
  return /\bproduct_id\b/i.test(haystack) && /\bvariant_key\b/i.test(haystack);
}

export function toSupplierOfferWriteErrorResponse(error) {
  const haystack = collectErrorHaystack(error);
  if (isCatalogProductUniqueViolation(error)) {
    return {
      status: 'error',
      code: 'duplicate_catalog_product',
      message: DUPLICATE_CATALOG_PRODUCT_MESSAGE
    };
  }
  if (
    isSupplierOfferUniqueViolation(error) ||
    isPgUniqueViolation(error) ||
    looksLikePostgresConstraintError(error) ||
    /supplier_products_product_supplier_location_variant/i.test(haystack) ||
    /duplicate key|violates unique constraint/i.test(haystack)
  ) {
    return {
      status: 'error',
      code: 'duplicate_supplier_variant',
      message: DUPLICATE_SUPPLIER_VARIANT_MESSAGE
    };
  }
  return {
    status: 'error',
    code: 'supplier_product_write_failed',
    message: GENERIC_SUPPLIER_PRODUCT_WRITE_MESSAGE
  };
}

export function toCatalogProductWriteErrorResponse(error) {
  if (isCatalogProductUniqueViolation(error) || isPgUniqueViolation(error)) {
    return {
      status: 'error',
      code: 'duplicate_catalog_product',
      message: DUPLICATE_CATALOG_PRODUCT_MESSAGE
    };
  }
  if (looksLikePostgresConstraintError(error)) {
    return {
      status: 'error',
      code: 'duplicate_catalog_product',
      message: DUPLICATE_CATALOG_PRODUCT_MESSAGE
    };
  }
  return {
    status: 'error',
    code: 'catalog_product_write_failed',
    message: GENERIC_SUPPLIER_PRODUCT_WRITE_MESSAGE
  };
}

function sameSupplier(row, supplierId) {
  return String(row?.supplier_id) === String(supplierId);
}

function sameVariantKey(row, variantKey) {
  return String(row?.variant_key || '').trim() === String(variantKey || '').trim();
}

function sameOutlet(row, outletId) {
  const wanted = String(outletId || '').trim();
  if (!wanted) return false;
  return String(row?.outlet_id || '').trim() === wanted;
}

export function findOwnOfferForVariantLocation(
  offers = [],
  { supplierId, location, variantKey, outletId } = {}
) {
  const rows = (offers || []).filter((row) => sameSupplier(row, supplierId));
  const key = String(variantKey || '').trim();

  if (key) {
    const byLocation = rows.find(
      (row) => sameVariantKey(row, key) && supplierOfferLocationsMatch(row?.location, location)
    );
    if (byLocation) return byLocation;

    const byOutlet = rows.find((row) => sameVariantKey(row, key) && sameOutlet(row, outletId));
    if (byOutlet) return byOutlet;
    return null;
  }

  return (
    rows.find(
      (row) =>
        !String(row?.variant_key || '').trim() &&
        supplierOfferLocationsMatch(row?.location, location)
    ) || null
  );
}

export function findOwnOfferForUniqueConflict(
  offers = [],
  { supplierId, location, variantKey, outletId } = {}
) {
  const matched = findOwnOfferForVariantLocation(offers, {
    supplierId,
    location,
    variantKey,
    outletId
  });
  if (matched) return matched;

  const key = String(variantKey || '').trim();
  if (!key) return null;

  return (
    (offers || []).find(
      (row) =>
        sameSupplier(row, supplierId) &&
        sameVariantKey(row, key) &&
        supplierOfferLocationsMatch(row?.location, location)
    ) ||
    (offers || []).find((row) => sameSupplier(row, supplierId) && sameVariantKey(row, key)) ||
    null
  );
}

export function isExistingOfferUpdatableOnCreate(row) {
  const status = String(row?.status || '').toLowerCase();
  return status === 'pending' || status === 'rejected';
}

export async function recoverOwnOfferAfterUniqueViolation(
  supabase,
  { productId, supplierId, location, variantKey, outletId } = {}
) {
  const lookup = await loadOwnSupplierOffersForProduct(supabase, {
    productId,
    supplierId
  });
  if (lookup.error) {
    return { offer: null, rows: [], error: lookup.error };
  }
  const offer = findOwnOfferForUniqueConflict(lookup.rows, {
    supplierId,
    location,
    variantKey,
    outletId
  });
  return { offer: offer || null, rows: lookup.rows || [], error: null };
}

export async function loadOwnSupplierOffersForProduct(
  supabase,
  { productId, supplierId, variantKey = null } = {}
) {
  if (!supabase || !productId || !supplierId) {
    return { rows: [], error: null };
  }
  let query = supabase
    .from('supplier_products')
    .select(OWN_OFFER_SELECT)
    .eq('product_id', productId)
    .eq('supplier_id', supplierId)
    .limit(200);
  if (String(variantKey || '').trim()) {
    query = query.eq('variant_key', String(variantKey).trim());
  }
  const { data, error } = await query;
  if (error) {
    return { rows: [], error };
  }
  return { rows: data || [], error: null };
}
