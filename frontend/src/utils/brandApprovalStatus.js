export const BRAND_APPROVAL_STATUS = {
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
  UNREGISTERED: 'unregistered',
  MISSING: 'missing',
  UNKNOWN: 'unknown'
};

export function normalizeBrandApprovalStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'approved') return BRAND_APPROVAL_STATUS.APPROVED;
  if (status === 'pending') return BRAND_APPROVAL_STATUS.PENDING;
  if (status === 'rejected') return BRAND_APPROVAL_STATUS.REJECTED;
  if (status === 'unregistered' || status === 'missing') return status;
  if (!status) return BRAND_APPROVAL_STATUS.MISSING;
  return BRAND_APPROVAL_STATUS.UNKNOWN;
}

export function isBrandApprovedForProductSubmit(status) {
  return normalizeBrandApprovalStatus(status) === BRAND_APPROVAL_STATUS.APPROVED;
}

/** Catalog dedup leftover — not an admin rejection of this supplier's brand request. */
export function isAutoMergedDuplicateBrandReason(reason) {
  const text = String(reason || '');
  return (
    /merged automatically/i.test(text) || /duplicate of (approved brand\s+)?["“'`]/i.test(text)
  );
}

export function getBrandApprovalWarning(status, brandName = '', apiMessage = '', productStatus = '') {
  const productNormalized = String(productStatus || '').trim().toLowerCase();
  if (productNormalized === 'approved' || productNormalized === 'active') {
    return null;
  }

  const normalized = normalizeBrandApprovalStatus(status);
  const label = String(brandName || '').trim() || 'This brand';
  const message = String(apiMessage || '');
  if (isAutoMergedDuplicateBrandReason(message)) {
    return null;
  }

  if (message && normalized !== BRAND_APPROVAL_STATUS.APPROVED) {
    return {
      tone: normalized === BRAND_APPROVAL_STATUS.REJECTED ? 'danger' : 'warning',
      title:
        normalized === BRAND_APPROVAL_STATUS.PENDING
          ? 'Brand approval pending'
          : normalized === BRAND_APPROVAL_STATUS.REJECTED
            ? 'Brand approval rejected'
            : 'Brand approval required',
      message
    };
  }

  if (normalized === BRAND_APPROVAL_STATUS.APPROVED) {
    return null;
  }
  if (normalized === BRAND_APPROVAL_STATUS.PENDING) {
    return {
      tone: 'warning',
      title: 'Brand approval pending',
      message: `Brand approval pending for "${label}". Wait for admin approval before submitting products.`
    };
  }
  if (normalized === BRAND_APPROVAL_STATUS.REJECTED) {
    return {
      tone: 'danger',
      title: 'Brand approval rejected',
      message: `Brand "${label}" was rejected by admin. Choose another brand or request approval again under Select yourself.`
    };
  }
  if (normalized === BRAND_APPROVAL_STATUS.MISSING) {
    return null;
  }
  return {
    tone: 'warning',
    title: 'Brand approval required',
    message: `Brand approval required for "${label}". Request this brand under Select yourself and wait for admin approval before submitting products.`
  };
}
