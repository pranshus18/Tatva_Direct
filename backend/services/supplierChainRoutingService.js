import { getViewerBrandTokensForRole, normalizeChainNameKey } from './supplierBrandGuardService.js';

export const SUPPLIER_ROLE_SET = new Set([
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
]);

export const PARENT_ROLE_BY_MY_ROLE = {
  retailer: 'dealer',
  dealer: 'local_distributor',
  local_distributor: 'regional_distributor',
  regional_distributor: 'stockist',
  stockist: 'manufacturer',
  manufacturer: null
};

export const ROLE_DEPTH = {
  manufacturer: 0,
  stockist: 1,
  regional_distributor: 2,
  local_distributor: 3,
  dealer: 4,
  retailer: 5
};

export function userHasSupplierRole(profile, role) {
  if (!profile || !role) return false;
  if (profile.supplierRole === role) return true;
  const entries = Array.isArray(profile.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  return entries.some((e) => e && e.role === role);
}

export function getMySupplierRoles(profile, previewRole) {
  const roles = new Set();
  const pr = (previewRole || '').trim();
  if (pr && SUPPLIER_ROLE_SET.has(pr)) {
    roles.add(pr);
    return [...roles];
  }
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  for (const e of entries) {
    if (e?.role && SUPPLIER_ROLE_SET.has(e.role)) roles.add(e.role);
  }
  // Legacy fallback only when company role entries are not present.
  if (roles.size === 0 && profile?.supplierRole && SUPPLIER_ROLE_SET.has(profile.supplierRole)) {
    roles.add(profile.supplierRole);
  }
  return [...roles];
}

export function sortRolesByChainDepthDesc(roles) {
  return [...roles].sort((a, b) => (ROLE_DEPTH[b] ?? -1) - (ROLE_DEPTH[a] ?? -1));
}

export function normalizeChainRolesFromStages(stages) {
  if (!Array.isArray(stages)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of stages) {
    const role = typeof raw === 'string' ? raw : raw?.role;
    if (!role || !SUPPLIER_ROLE_SET.has(role) || seen.has(role)) continue;
    out.push(role);
    seen.add(role);
  }
  return out;
}

export async function loadAdminBrandChainsByName({ supabase, brandNames }) {
  const names = [...new Set((brandNames || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (names.length === 0) return new Map();
  const wanted = new Set(names.map((n) => normalizeChainNameKey(n)).filter(Boolean));
  const { data, error } = await supabase
    .from('category_supply_chains')
    .select('id, category_name, stages, updated_at');
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    const key = normalizeChainNameKey(row?.category_name);
    if (!key || !wanted.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

export function resolveRequiredUpstreamRoleFromAdminChain({ profile, brandKey, chainRow }) {
  const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);
  if (chainRoles.length < 2) {
    return {
      source: 'fallback_profile',
      chainRoles: [],
      buyerRole: null,
      requiredUpstreamRole: null
    };
  }

  const myRoles = getMySupplierRoles(profile, '');
  if (myRoles.length === 0) {
    return {
      source: 'fallback_profile',
      chainRoles,
      buyerRole: null,
      requiredUpstreamRole: null
    };
  }

  const myRoleSet = new Set(myRoles);
  const roleCandidates = [];
  for (let idx = 1; idx < chainRoles.length; idx += 1) {
    const buyerRole = chainRoles[idx];
    const requiredUpstreamRole = chainRoles[idx - 1];
    if (!myRoleSet.has(buyerRole)) continue;
    roleCandidates.push({ buyerRole, requiredUpstreamRole });
  }

  if (roleCandidates.length === 0) {
    return {
      source: 'chain_not_applicable',
      chainRoles,
      buyerRole: null,
      requiredUpstreamRole: null
    };
  }

  const brandMatchedRoles = myRoles.filter((role) =>
    getViewerBrandTokensForRole(profile, role).has(brandKey)
  );
  const preferredRoles = brandMatchedRoles.length > 0 ? brandMatchedRoles : myRoles;
  const preferredSet = new Set(preferredRoles);

  const sortedCandidates = roleCandidates.sort(
    (a, b) => (ROLE_DEPTH[b.buyerRole] ?? -1) - (ROLE_DEPTH[a.buyerRole] ?? -1)
  );
  const matchedPreferred =
    sortedCandidates.find((c) => preferredSet.has(c.buyerRole)) || sortedCandidates[0];

  return {
    source: 'admin_chain',
    chainRoles,
    buyerRole: matchedPreferred.buyerRole,
    requiredUpstreamRole: matchedPreferred.requiredUpstreamRole
  };
}

export function getImmediateParentRolesUnion(profile) {
  const myRoles = getMySupplierRoles(profile, '');
  const parents = new Set();
  for (const r of myRoles) {
    const p = PARENT_ROLE_BY_MY_ROLE[r];
    if (p) parents.add(p);
  }
  return parents;
}

export function sellerMatchesUpstreamRoles(sellerProfile, allowedParentRolesSet) {
  if (!sellerProfile || !allowedParentRolesSet || allowedParentRolesSet.size === 0) return false;
  for (const role of allowedParentRolesSet) {
    if (userHasSupplierRole(sellerProfile, role)) return true;
  }
  return false;
}

export function pickMatchingUpstreamRoleForSeller(sellerProfile, allowedParentRolesSet) {
  if (!sellerProfile || !allowedParentRolesSet || allowedParentRolesSet.size === 0) return null;
  const ordered = [...allowedParentRolesSet].sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99));
  for (const role of ordered) {
    if (userHasSupplierRole(sellerProfile, role)) return role;
  }
  return null;
}

export function pickDisplayRoleFromAllowedSet(allowedParentRolesSet) {
  if (!allowedParentRolesSet || allowedParentRolesSet.size === 0) return null;
  return [...allowedParentRolesSet].sort((a, b) => (ROLE_DEPTH[b] ?? -1) - (ROLE_DEPTH[a] ?? -1))[0] || null;
}

export function getViewerBrandTokensUnionForAllRoles(profile) {
  const tokens = new Set();
  for (const r of getMySupplierRoles(profile, '')) {
    getViewerBrandTokensForRole(profile, r).forEach((t) => tokens.add(t));
  }
  return tokens;
}
