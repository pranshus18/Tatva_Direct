import { resolveAuthorizationCertificateUrls, resolveBrandApprovalDocumentUrls } from './authorizationCertificateUrls';

/** All persisted companyInfoEntries — never collapse to a single legacy row when multiples exist. */
export function getCompanyInfoEntriesForSave(profile) {
  const entries = profile?.companyInfoEntries;
  if (Array.isArray(entries) && entries.length > 0) {
    return entries.map((entry) => ({ ...(entry || {}) }));
  }

  const hasLegacy =
    String(profile?.supplierRole || '').trim() ||
    String(profile?.brands || '').trim() ||
    String(profile?.gstin || '').trim() ||
    String(profile?.companyName || '').trim() ||
    String(profile?.ownershipDetails || '').trim() ||
    resolveAuthorizationCertificateUrls(profile || {}).length > 0 ||
    resolveBrandApprovalDocumentUrls(profile || {}).length > 0;

  if (!hasLegacy) return [];

  return [
    {
      id: 'legacy',
      role: profile?.supplierRole || '',
      brands: profile?.brands || '',
      gstin: profile?.gstin || '',
      companyName: profile?.companyName || '',
      ownershipDetails: profile?.ownershipDetails || '',
      brandApprovalDocumentUrl: profile?.brandApprovalDocumentUrl || '',
      authorizationCertificateUrl: profile?.authorizationCertificateUrl || '',
      minimumOrderValue: profile?.minimumOrderValue ?? ''
    }
  ];
}

/**
 * Merge Step 2 form edits back into the full profile without dropping other brand entries.
 */
export function mergeFormStepProfile(fullProfile, formProfile) {
  const formEntries = Array.isArray(formProfile?.companyInfoEntries) ? formProfile.companyInfoEntries : [];
  const formById = new Map(formEntries.map((entry) => [entry.id, entry]));
  const merged = [];

  for (const entry of fullProfile?.companyInfoEntries || []) {
    if (formById.has(entry.id)) {
      merged.push({ ...formById.get(entry.id) });
    } else {
      merged.push({ ...(entry || {}) });
    }
  }

  for (const entry of formEntries) {
    if (!merged.some((row) => row.id === entry.id)) {
      merged.push({ ...(entry || {}) });
    }
  }

  return {
    ...fullProfile,
    companyInfoEntries: merged
  };
}

/** Build PUT payload that keeps every brand entry while syncing legacy top-level fields. */
export function buildSupplierChainSavePayload(profile, entries = null) {
  const nextEntries = entries || getCompanyInfoEntriesForSave(profile);
  const first = nextEntries[0] || {};
  return {
    ...profile,
    companyInfoEntries: nextEntries,
    supplierRole: first.role || profile?.supplierRole || '',
    brands: first.brands || profile?.brands || '',
    gstin: first.gstin || profile?.gstin || '',
    companyName: first.companyName || profile?.companyName || '',
    minimumOrderValue: first.minimumOrderValue ?? profile?.minimumOrderValue ?? ''
  };
}
