import { resolveAuthorizationCertificateUrls, resolveBrandApprovalDocumentUrls } from './authorizationCertificateUrls';
import { brandKeyForDuplicateCheck } from './supplierChainEntryValidation';

export const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional Distributor',
  local_distributor: 'Local Distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

export function formatSupplyChainRoleLabel(role) {
  const key = String(role || '').trim();
  if (!key) return 'Not set';
  return SUPPLY_CHAIN_ROLE_LABELS[key] || key;
}

/** @param {import('./supplierChainEntryValidation').ChainEntry[]} entries */
export function getSupplyChainAssignmentRows(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const brand = String(entry?.brands || '').trim();
      if (!brand) return null;
      const role = String(entry?.role || '').trim();
      const roleDocs = resolveAuthorizationCertificateUrls(entry);
      return {
        id: entry?.id || `entry-${index}`,
        brand,
        role,
        roleLabel: formatSupplyChainRoleLabel(role),
        hasRole: !!role,
        hasRoleDocuments: roleDocs.length > 0,
        registrationStarted: entry?.supplyChainRegistrationStarted === true || !!role || roleDocs.length > 0
      };
    })
    .filter(Boolean);
}

/** Union entries by id so loading profile never drops earlier brand rows. */
export function mergeCompanyInfoEntriesById(...entryLists) {
  const merged = [];
  const indexById = new Map();

  const upsert = (rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const entry = { ...rawEntry };
    const id = String(entry.id || '').trim();
    if (id && indexById.has(id)) {
      const idx = indexById.get(id);
      merged[idx] = { ...merged[idx], ...entry };
      return;
    }
    const idx = merged.length;
    if (!entry.id) {
      entry.id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `entry-${Date.now()}-${idx}`;
    }
    merged.push(entry);
    indexById.set(entry.id, idx);
  };

  for (const list of entryLists) {
    for (const entry of Array.isArray(list) ? list : []) {
      upsert(entry);
    }
  }

  return merged;
}

/** Merge profile rows that refer to the same brand (e.g. Philips vs Phillips). */
export function deduplicateCompanyInfoEntriesByBrand(entries = []) {
  const merged = [];
  const indexByBrandKey = new Map();

  const pickBrandLabel = (left, right) => {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a) return b;
    if (!b) return a;
    return a.length <= b.length ? a : b;
  };

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const brand = String(rawEntry?.brands || '').trim();
    if (!brand) {
      merged.push({ ...rawEntry });
      continue;
    }

    const brandKey = brandKeyForDuplicateCheck(brand);
    if (indexByBrandKey.has(brandKey)) {
      const idx = indexByBrandKey.get(brandKey);
      const existing = merged[idx] || {};
      merged[idx] = {
        ...existing,
        ...rawEntry,
        id: existing.id || rawEntry.id,
        brands: pickBrandLabel(existing.brands, rawEntry.brands),
        brandApprovalDocumentUrls: [
          ...new Set([
            ...(Array.isArray(existing.brandApprovalDocumentUrls) ? existing.brandApprovalDocumentUrls : []),
            ...(Array.isArray(rawEntry.brandApprovalDocumentUrls) ? rawEntry.brandApprovalDocumentUrls : [])
          ])
        ],
        authorizationCertificateUrls: [
          ...new Set([
            ...(Array.isArray(existing.authorizationCertificateUrls) ? existing.authorizationCertificateUrls : []),
            ...(Array.isArray(rawEntry.authorizationCertificateUrls) ? rawEntry.authorizationCertificateUrls : [])
          ])
        ]
      };
      continue;
    }

    const idx = merged.length;
    merged.push({ ...rawEntry });
    indexByBrandKey.set(brandKey, idx);
  }

  return merged;
}

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

export function ensureAtLeastOneCompanyInfoEntry(profile) {
  const entries = getCompanyInfoEntriesForSave(profile);
  if (entries.length > 0) return entries;
  return [
    {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `entry-${Date.now()}`,
      role: '',
      brands: '',
      gstin: '',
      companyName: '',
      ownershipDetails: '',
      brandApprovalDocumentUrls: [],
      brandApprovalDocumentUrl: '',
      authorizationCertificateUrls: [],
      authorizationCertificateUrl: '',
      minimumOrderValue: ''
    }
  ];
}

export function getEntriesWithBrands(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) =>
    String(entry?.brands || '').trim()
  );
}

/** When a brand is picked in Step 1, mark the entry ready for Step 2 supply-chain forms. */
export function syncBrandEntriesForSupplyChainStep(entries = []) {
  return entries.map((entry) => {
    const brand = String(entry?.brands || '').trim();
    if (!brand) return { ...entry };
    return { ...entry, supplyChainRegistrationStarted: true };
  });
}

export function buildSupplyChainFormProfile(profile) {
  if (!profile) return null;
  const brandedEntries = getEntriesWithBrands(getCompanyInfoEntriesForSave(profile));
  return {
    ...profile,
    companyInfoEntries: brandedEntries
  };
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
  const nextEntries = deduplicateCompanyInfoEntriesByBrand(entries || getCompanyInfoEntriesForSave(profile));
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
