import { supabase } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';
import { normalizeBrandKey } from './supplyChainSharedService.js';
import {
  resolveBrandApprovalDocumentUrls,
  setBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls,
  setAuthorizationCertificateUrls
} from '../utils/authorizationCertificateUrls.js';

const ROLE_SET = new Set([
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
]);

function parseEntryBrandList(brands) {
  if (brands == null || brands === '') return [];
  if (Array.isArray(brands)) {
    return [...new Set(brands.map(String).map((s) => s.trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(brands)
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

export function normalizeCompanyInfoEntries(rawEntries) {
  const raw = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries && typeof rawEntries === 'object'
      ? [rawEntries]
      : [];
  const normalized = [];

  for (const e of raw) {
    const role = String(e?.role || '').trim();
    let minimumOrderValue = null;
    if (role && role !== 'retailer') {
      const rawMov = e?.minimumOrderValue;
      if (rawMov !== '' && rawMov !== null && rawMov !== undefined) {
        const v = parseFloat(rawMov);
        if (Number.isFinite(v) && v >= 0) {
          minimumOrderValue = Math.round(v * 100) / 100;
          if (minimumOrderValue === 0) minimumOrderValue = null;
        }
      }
    }
    const certificateFields = setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(e));
    const brandDocumentFields = setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(e));
    const brandList = parseEntryBrandList(e?.brands);
    const brandsForRows = brandList.length > 0 ? brandList : [''];
    const baseId = e?.id || uuidv4();

    brandsForRows.forEach((brand, index) => {
      normalized.push({
        id: index === 0 ? baseId : uuidv4(),
        role,
        brands: brand,
        gstin: e?.gstin != null && e.gstin !== '' ? String(e.gstin).trim() : '',
        companyName: e?.companyName != null && e.companyName !== '' ? String(e.companyName).trim() : '',
        ownershipDetails:
          e?.ownershipDetails != null && e.ownershipDetails !== '' ? String(e.ownershipDetails).trim() : '',
        brandApprovalDocumentUrls: brandDocumentFields.brandApprovalDocumentUrls,
        brandApprovalDocumentUrl: brandDocumentFields.brandApprovalDocumentUrl,
        authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
        authorizationCertificateUrl: certificateFields.authorizationCertificateUrl,
        ...(minimumOrderValue != null ? { minimumOrderValue } : {})
      });
    });
  }

  return normalized;
}

export function buildChainPayloadFromProfileData(profileData) {
  const entries = normalizeCompanyInfoEntries(profileData.companyInfoEntries || []);
  return {
    supplierRole: String(profileData.supplierRole || '').trim(),
    brands: typeof profileData.brands === 'string' ? profileData.brands : profileData.brands ? String(profileData.brands) : '',
    companyInfoEntries: entries
  };
}

function mergeUniqueChainEntries(...entryLists) {
  const merged = [];
  const seen = new Set();

  for (const raw of entryLists) {
    for (const entry of normalizeCompanyInfoEntries(raw || [])) {
      const brand = String(entry?.brands || '').trim().toLowerCase();
      const key = brand || `id:${entry?.id || merged.length}`;
      if (seen.has(key)) {
        const idx = merged.findIndex((row) => {
          const rowBrand = String(row?.brands || '').trim().toLowerCase();
          return (rowBrand || `id:${row?.id || ''}`) === key;
        });
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...entry };
        }
        continue;
      }
      seen.add(key);
      merged.push({ ...entry });
    }
  }

  return merged;
}

/**
 * Profile used for brand guards and supplier brand pickers.
 * Unions saved, draft, and pending Select yourself entries so declared brands stay usable.
 */
export function buildEffectiveSupplierChainProfile(profile, pendingPayload) {
  const base = profile || {};
  const approvedChain = baselineChainFromProfile(base);
  const draft = base.chainProfileDraft || {};
  const draftEntries = normalizeCompanyInfoEntries(draft.companyInfoEntries || []);
  const pendingEntries =
    pendingPayload && typeof pendingPayload === 'object'
      ? normalizeCompanyInfoEntries(pendingPayload.companyInfoEntries || [])
      : [];

  const mergedEntries = mergeUniqueChainEntries(
    approvedChain.companyInfoEntries,
    draftEntries,
    pendingEntries
  );

  const supplierRole =
    String(pendingPayload?.supplierRole || '').trim() ||
    String(draft?.supplierRole || '').trim() ||
    approvedChain.supplierRole ||
    '';

  const brands =
    (typeof pendingPayload?.brands === 'string' && pendingPayload.brands.trim() && pendingPayload.brands) ||
    (typeof draft?.brands === 'string' && draft.brands.trim() && draft.brands) ||
    approvedChain.brands ||
    mergedEntries[0]?.brands ||
    '';

  return {
    ...base,
    supplierRole,
    brands,
    companyInfoEntries: mergedEntries.length > 0 ? mergedEntries : approvedChain.companyInfoEntries
  };
}

function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

function brandKeysForEntryMatch(label) {
  const key = normalizeBrandKey(String(label || '').trim());
  if (!key) return [];
  return [key, collapseRepeatedLetters(key)];
}

function chainEntryMatchesBrand(entry, brandName) {
  const label = String(entry?.brands || '').trim();
  if (!label) return false;
  const wantedKeys = brandKeysForEntryMatch(brandName);
  if (wantedKeys.length === 0) return false;

  const checkLabel = (value) => {
    const entryKeys = brandKeysForEntryMatch(value);
    return wantedKeys.some((wanted) => entryKeys.includes(wanted));
  };

  if (checkLabel(label)) return true;
  return parseEntryBrandList(label).some((part) => checkLabel(part));
}

function createStubBrandChainEntry(brandName) {
  return {
    id: uuidv4(),
    role: '',
    brands: brandName,
    gstin: '',
    companyName: '',
    ownershipDetails: '',
    brandApprovalDocumentUrls: [],
    brandApprovalDocumentUrl: '',
    authorizationCertificateUrls: [],
    authorizationCertificateUrl: ''
  };
}

/** Brand names declared anywhere in saved profile, draft, or pending submission. */
export function collectDeclaredBrandNamesFromProfiles(...profiles) {
  const names = new Set();
  const addName = (value) => {
    const trimmed = String(value || '').trim();
    if (trimmed) names.add(trimmed);
  };

  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    parseEntryBrandList(profile.brands).forEach(addName);
    for (const entry of normalizeCompanyInfoEntries(profile.companyInfoEntries || [])) {
      parseEntryBrandList(entry?.brands).forEach(addName);
    }
    const draft = profile.chainProfileDraft;
    if (draft && typeof draft === 'object') {
      parseEntryBrandList(draft.brands).forEach(addName);
      for (const entry of normalizeCompanyInfoEntries(draft.companyInfoEntries || [])) {
        parseEntryBrandList(entry?.brands).forEach(addName);
      }
    }
  }

  return [...names];
}

/**
 * Admin-approved brands for this supplier.
 * Includes brands they requested plus any declared brand name that is globally approved.
 */
export async function fetchSupplierApprovedBrands(userId, profileContext = null) {
  if (!userId) return [];
  const byKey = new Map();

  const addRows = (rows = []) => {
    for (const row of rows) {
      const name = String(row?.name || '').trim();
      const key = normalizeBrandKey(row?.normalized_name || name);
      if (!name || !key || String(row?.status || '').toLowerCase() !== 'approved') continue;
      if (!byKey.has(key)) byKey.set(key, { name, normalized_name: key, status: 'approved' });
    }
  };

  try {
    const { data: requestedRows, error: requestedError } = await supabase
      .from('brands')
      .select('name, normalized_name, status')
      .eq('requested_by', userId)
      .eq('status', 'approved');
    if (requestedError) throw requestedError;
    addRows(requestedRows);

    const declaredNames = collectDeclaredBrandNamesFromProfiles(profileContext);
    const declaredKeys = [...new Set(declaredNames.map((name) => normalizeBrandKey(name)).filter(Boolean))];
    if (declaredKeys.length > 0) {
      const { data: declaredRows, error: declaredError } = await supabase
        .from('brands')
        .select('name, normalized_name, status')
        .eq('status', 'approved')
        .in('normalized_name', declaredKeys);
      if (declaredError) throw declaredError;
      addRows(declaredRows);
    }

    return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch (e) {
    console.error('[supplierChainProfile] fetchSupplierApprovedBrands:', e?.message || e);
    return [];
  }
}

/**
 * Add stub chain entries for admin-approved brands missing from companyInfoEntries.
 * Does not remove or overwrite existing entries.
 */
export function mergeApprovedBrandsIntoChainEntries(chainProfile, approvedBrandRows = []) {
  const base = chainProfile || {};
  const entries = [...normalizeCompanyInfoEntries(base.companyInfoEntries || [])];
  const addedNames = [];

  for (const row of approvedBrandRows) {
    const name = String(row?.name || '').trim();
    if (!name || String(row?.status || 'approved').toLowerCase() !== 'approved') continue;
    if (entries.some((entry) => chainEntryMatchesBrand(entry, name))) continue;
    if (addedNames.some((added) => chainEntryMatchesBrand({ brands: added }, name))) continue;
    entries.push(createStubBrandChainEntry(name));
    addedNames.push(name);
  }

  return {
    ...base,
    companyInfoEntries: entries,
    brands: base.brands || entries[0]?.brands || ''
  };
}

/** No-op for saved profile: approved brands are exposed via adminApprovedBrands, not auto form rows. */
export async function syncApprovedBrandsIntoUserProfile(userId, profile) {
  return profile || {};
}

/** Load saved profile merged with any pending chain submission and approved brands. */
export async function loadEffectiveSupplierChainProfile(userId, profile) {
  const pending = await fetchPendingChainRequest(userId);
  const effective = buildEffectiveSupplierChainProfile(profile, pending?.payload || null);
  const approvedBrands = await fetchSupplierApprovedBrands(userId, profile);
  return mergeApprovedBrandsIntoChainEntries(effective, approvedBrands);
}

export function baselineChainFromProfile(profile) {
  const p = profile || {};
  let entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
  if (entries.length === 0) {
    const legacyHasValues = Boolean(
      String(p.supplierRole || '').trim() ||
      String(p.brands || '').trim() ||
      String(p.gstin || '').trim() ||
      String(p.companyName || '').trim() ||
      String(p.ownershipDetails || '').trim() ||
      String(p.brandApprovalDocumentUrl || '').trim() ||
      (Array.isArray(p.brandApprovalDocumentUrls) && p.brandApprovalDocumentUrls.length > 0) ||
      String(p.authorizationCertificateUrl || '').trim() ||
      (Array.isArray(p.authorizationCertificateUrls) && p.authorizationCertificateUrls.length > 0) ||
      (p.minimumOrderValue !== '' && p.minimumOrderValue !== null && p.minimumOrderValue !== undefined)
    );
    if (legacyHasValues) {
      entries = normalizeCompanyInfoEntries([
        {
          role: String(p.supplierRole || '').trim(),
          brands: typeof p.brands === 'string' ? p.brands : '',
          gstin: String(p.gstin || '').trim(),
          companyName: String(p.companyName || '').trim(),
          ownershipDetails: String(p.ownershipDetails || '').trim(),
          brandApprovalDocumentUrl: String(p.brandApprovalDocumentUrl || '').trim(),
          brandApprovalDocumentUrls: Array.isArray(p.brandApprovalDocumentUrls)
            ? p.brandApprovalDocumentUrls
            : [],
          authorizationCertificateUrl: String(p.authorizationCertificateUrl || '').trim(),
          authorizationCertificateUrls: Array.isArray(p.authorizationCertificateUrls)
            ? p.authorizationCertificateUrls
            : [],
          minimumOrderValue: p.minimumOrderValue ?? ''
        }
      ]);
    }
  }
  return {
    supplierRole: String(p.supplierRole || '').trim(),
    brands: typeof p.brands === 'string' ? p.brands : p.brands ? String(p.brands) : '',
    companyInfoEntries: entries
  };
}

export function chainPayloadSignature(payload) {
  const p = payload || {};
  const entries = (p.companyInfoEntries || []).map((e) => ({
    role: String(e?.role || '').trim(),
    brands: String(e?.brands || '').trim(),
    gstin: String(e?.gstin || '').trim(),
    companyName: String(e?.companyName || '').trim(),
    ownershipDetails: String(e?.ownershipDetails || '').trim(),
    minimumOrderValue: e?.minimumOrderValue != null && e.minimumOrderValue !== '' ? Number(e.minimumOrderValue) : null
  }));
  return JSON.stringify({
    supplierRole: String(p.supplierRole || '').trim(),
    brands: String(p.brands || '').trim(),
    entries
  });
}

export function hasAnySupplyChainRole(payload) {
  const p = payload || {};
  if (String(p.supplierRole || '').trim() && ROLE_SET.has(String(p.supplierRole || '').trim())) return true;
  return (p.companyInfoEntries || []).some((e) => {
    const r = String(e?.role || '').trim();
    return r && ROLE_SET.has(r);
  });
}

export async function fetchPendingChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, payload, status, rejection_reason, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('[supplierChainProfile] fetchPendingChainRequest:', e?.message || e);
    return null;
  }
}

export async function replacePendingChainRequest(userId, payload) {
  await supabase.from('supplier_chain_profile_requests').delete().eq('user_id', userId).eq('status', 'pending');
  const { data, error } = await supabase
    .from('supplier_chain_profile_requests')
    .insert({
      user_id: userId,
      payload,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clearPendingChainRequest(userId) {
  await supabase.from('supplier_chain_profile_requests').delete().eq('user_id', userId).eq('status', 'pending');
}

export async function fetchLatestRejectedChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, rejection_reason, reviewed_at')
      .eq('user_id', userId)
      .eq('status', 'rejected')
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}

/** Most recent request row (any status), for UI hints */
export async function fetchLatestChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, status, rejection_reason, reviewed_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}
