function normalizeSpecShape(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSpecShape(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = normalizeSpecShape(value[key]);
      });
    return out;
  }
  return value;
}

export function areSpecificationsEqual(currentSpecs = {}, nextSpecs = {}) {
  return JSON.stringify(normalizeSpecShape(currentSpecs || {})) === JSON.stringify(normalizeSpecShape(nextSpecs || {}));
}

export function shouldMoveToPendingForSpecChange({ specificationsProvided, currentSpecs, nextSpecs }) {
  if (!specificationsProvided) return false;
  return !areSpecificationsEqual(currentSpecs, nextSpecs);
}

function isApprovedStatus(status) {
  return String(status || '').toLowerCase() === 'approved';
}

/**
 * Auto-approve a new supplier offer when the shared catalog product is already known/live.
 * Different variants of an existing product do not need a separate admin approval gate.
 *
 * Still requires approval for brand-new catalog products (nothing approved yet).
 */
export function shouldAutoApproveSupplierOfferOnCreate({
  hasApprovedSameVariantOffer = false,
  catalogProductStatus = '',
  hasAnyApprovedOfferForProduct = false
} = {}) {
  if (hasApprovedSameVariantOffer) return true;
  if (isApprovedStatus(catalogProductStatus)) return true;
  if (hasAnyApprovedOfferForProduct) return true;
  return false;
}

/**
 * Spec / variant-identity edits should not demote an offer back to pending when the
 * catalog product (or any offer for it) is already approved.
 */
export function shouldRequireApprovalForVariantSpecChange({
  catalogProductStatus = '',
  hasAnyApprovedOfferForProduct = false,
  currentOfferStatus = ''
} = {}) {
  if (isApprovedStatus(catalogProductStatus)) return false;
  if (hasAnyApprovedOfferForProduct) return false;
  if (isApprovedStatus(currentOfferStatus)) return false;
  return true;
}

export default {
  areSpecificationsEqual,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange
};
