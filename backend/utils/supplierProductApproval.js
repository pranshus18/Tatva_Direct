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
 * Auto-approve a new supplier offer only when the attach is a clear re-list of a product
 * that is already live — not when a weak name-only match or a brand-new catalog row is used.
 *
 * matchStrength:
 * - explicit: supplier picked an existing catalog product in the UI
 * - strong: GTIN / brand+MPN / identifier / exact catalog_key match
 * - weak: name+category only — always needs admin approval for the new offer
 * - none: brand-new catalog product
 */
export function shouldAutoApproveSupplierOfferOnCreate({
  hasApprovedSameVariantOffer = false,
  catalogProductStatus = '',
  hasAnyApprovedOfferForProduct = false,
  matchStrength = 'none'
} = {}) {
  if (hasApprovedSameVariantOffer) return true;

  const strength = String(matchStrength || 'none').trim().toLowerCase();
  const isConfirmedReList = strength === 'explicit' || strength === 'strong';
  if (!isConfirmedReList) return false;

  // Confirmed re-lists of a live marketplace product skip another admin gate.
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
