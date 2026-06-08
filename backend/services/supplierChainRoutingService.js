import { getViewerBrandTokensForRole } from './supplierBrandGuardService.js';
import {
  brandKeysMatchForChainLookup,
  normalizeBrandKey,
  normalizeChainRolesFromStages,
  SUPPLY_CHAIN_ROLES_IN_ORDER
} from './supplyChainSharedService.js';

export { normalizeChainRolesFromStages };

export const SUPPLIER_ROLE_SET = new Set([
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
]);

/** Legacy single-step fallback when no admin brand chain exists. */
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

/**
 * Given a buyer role, return the nearest upstream tier that appears in the admin chain
 * (walking backward through the standard role order). Skips tiers absent from admin
 * (e.g. retailer → local_distributor when dealer is not in the chain).
 */
export function findUpstreamRoleWalkback(buyerRole, rolesInAdminChain) {
  if (!buyerRole || !Array.isArray(rolesInAdminChain) || rolesInAdminChain.length === 0) {
    return null;
  }
  const present = new Set(rolesInAdminChain.filter((r) => SUPPLIER_ROLE_SET.has(r)));
  const buyerIdx = SUPPLY_CHAIN_ROLES_IN_ORDER.indexOf(buyerRole);
  if (buyerIdx <= 0) return null;
  for (let i = buyerIdx - 1; i >= 0; i -= 1) {
    const tier = SUPPLY_CHAIN_ROLES_IN_ORDER[i];
    if (present.has(tier)) return tier;
  }
  return null;
}

export async function loadAdminBrandChainsByName({ supabase, brandNames }) {
  const names = [...new Set((brandNames || []).map((b) => String(b || '').trim()).filter(Boolean))];
  const wantedKeys = [...new Set(names.map((n) => normalizeBrandKey(n)).filter(Boolean))];
  if (wantedKeys.length === 0) return new Map();

  const { data, error } = await supabase
    .from('category_supply_chains')
    .select('id, category_name, stages, updated_at');
  if (error) throw error;

  const rows = data || [];
  const map = new Map();
  for (const wantedKey of wantedKeys) {
    let matched = null;
    for (const row of rows) {
      const categoryKey = normalizeBrandKey(row?.category_name);
      if (!categoryKey) continue;
      if (categoryKey === wantedKey) {
        matched = row;
        break;
      }
    }
    if (!matched) {
      for (const row of rows) {
        const categoryKey = normalizeBrandKey(row?.category_name);
        if (brandKeysMatchForChainLookup(wantedKey, categoryKey)) {
          matched = row;
          break;
        }
      }
    }
    if (matched) map.set(wantedKey, matched);
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
    const myRolesSorted = sortRolesByChainDepthDesc(myRoles);
    const buyerRole = myRolesSorted[0] || null;
    const requiredUpstreamRole = buyerRole ? findUpstreamRoleWalkback(buyerRole, chainRoles) : null;
    if (buyerRole && requiredUpstreamRole) {
      return {
        source: 'admin_chain_inferred',
        chainRoles,
        buyerRole,
        requiredUpstreamRole
      };
    }
    return {
      source: 'chain_not_applicable',
      chainRoles,
      buyerRole: buyerRole || null,
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

/**
 * Resolve which upstream seller role(s) may fulfill an order for this brand.
 * Prefers the admin-defined chain (including chains that skip dealer, etc.).
 */
export function buildAllowedUpstreamRolesSet({ profile, brandKey, chainRow, parentRolesUnion }) {
  const chainRouting = resolveRequiredUpstreamRoleFromAdminChain({
    profile,
    brandKey,
    chainRow
  });

  let required = chainRouting.requiredUpstreamRole || null;

  if (!required && chainRow) {
    const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);
    const buyerRole =
      chainRouting.buyerRole || sortRolesByChainDepthDesc(getMySupplierRoles(profile, ''))[0] || null;
    if (buyerRole && chainRoles.length > 0) {
      required = findUpstreamRoleWalkback(buyerRole, chainRoles);
      if (required) {
        chainRouting.source = 'admin_chain_walkback';
        chainRouting.requiredUpstreamRole = required;
        chainRouting.buyerRole = buyerRole;
        chainRouting.chainRoles = chainRoles;
      }
    }
  }

  if (!required) {
    const buyerRole = sortRolesByChainDepthDesc(getMySupplierRoles(profile, ''))[0] || null;
    required = buyerRole ? findUpstreamRoleWalkback(buyerRole, SUPPLY_CHAIN_ROLES_IN_ORDER) : null;
    if (required) {
      chainRouting.source = chainRouting.source || 'standard_chain_walkback';
      chainRouting.requiredUpstreamRole = required;
      chainRouting.buyerRole = chainRouting.buyerRole || buyerRole;
    }
  }

  const allowedRolesSet =
    required && SUPPLIER_ROLE_SET.has(required)
      ? new Set([required])
      : parentRolesUnion && parentRolesUnion.size > 0
        ? parentRolesUnion
        : new Set();

  return { allowedRolesSet, chainRouting };
}

export function sellerMatchesUpstreamRoles(sellerProfile, allowedParentRolesSet) {
  if (!sellerProfile || !allowedParentRolesSet || allowedParentRolesSet.size === 0) return false;
  for (const role of allowedParentRolesSet) {
    if (userHasSupplierRole(sellerProfile, role)) return true;
  }
  return false;
}

/**
 * Pick the seller's role that is the nearest upstream tier to the buyer among allowed roles
 * (highest ROLE_DEPTH in the allowed set — e.g. dealer before local_distributor for a retailer).
 */
export function pickMatchingUpstreamRoleForSeller(sellerProfile, allowedParentRolesSet) {
  if (!sellerProfile || !allowedParentRolesSet || allowedParentRolesSet.size === 0) return null;
  const ordered = [...allowedParentRolesSet].sort((a, b) => (ROLE_DEPTH[b] ?? -1) - (ROLE_DEPTH[a] ?? -1));
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
