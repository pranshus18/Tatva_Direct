/**
 * Path A and Path B are mutually exclusive supplier scenarios.
 * A locked Path A assignment always wins over a Path B draft mode.
 */
export function resolveActiveBrandPath({ selectedAssignmentId = '', brandPathMode = null } = {}) {
  if (String(selectedAssignmentId || '').trim()) return 'pathA';
  if (brandPathMode === 'pathA' || brandPathMode === 'pathB') return brandPathMode;
  return null;
}

/** Path B only — typing/selecting an already-approved brand should nudge users to Path A. */
export function shouldShowApprovedBrandPathBAlert({
  approvedBrandsBlockingSave = [],
  hasBrandsNeedingApprovalRequest = false,
  activeBrandPath = null,
  hasConfiguredBrand = false
} = {}) {
  if (!Array.isArray(approvedBrandsBlockingSave) || approvedBrandsBlockingSave.length === 0) {
    return false;
  }
  if (activeBrandPath !== 'pathB' || !hasConfiguredBrand) return false;
  return !hasBrandsNeedingApprovalRequest;
}

export function shouldShowMixedApprovedBrandPathBAlert({
  approvedBrandsBlockingSave = [],
  hasBrandsNeedingApprovalRequest = false,
  activeBrandPath = null,
  hasConfiguredBrand = false
} = {}) {
  if (!Array.isArray(approvedBrandsBlockingSave) || approvedBrandsBlockingSave.length === 0) {
    return false;
  }
  if (activeBrandPath !== 'pathB' || !hasConfiguredBrand) return false;
  return Boolean(hasBrandsNeedingApprovalRequest);
}
