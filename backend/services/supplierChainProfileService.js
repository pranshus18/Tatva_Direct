import { supabase } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';
import {
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
