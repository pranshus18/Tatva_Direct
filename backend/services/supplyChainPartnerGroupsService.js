import {
  entryOverlapsViewerBrands,
  getViewerBrandTokensForRole,
  parseBrandTokens
} from './supplierBrandGuardService.js';
import {
  buildAllowedUpstreamRolesSet,
  getImmediateParentRolesUnion,
  getMySupplierRoles,
  loadAdminBrandChainsByName,
  PARENT_ROLE_BY_MY_ROLE,
  pickDisplayRoleFromAllowedSet,
  ROLE_DEPTH,
  sortRolesByChainDepthDesc,
  userHasSupplierRole
} from './supplierChainRoutingService.js';
import { mapSupplyChainPartner } from './supplierPartnerMapperService.js';
import { SUPPLY_CHAIN_ROLE_LABELS } from './supplierUpstreamRankingService.js';
import {
  normalizeBrandKey,
  normalizeChainRolesFromStages,
  SUPPLY_CHAIN_ROLES_IN_ORDER
} from './supplyChainSharedService.js';

/**
 * All supply-chain tiers above the buyer for this brand (from admin chain, or standard ladder).
 */
export function getUpstreamRolesForBuyerOnBrand({ buyerRole, chainRow }) {
  if (!buyerRole) return [];
  const buyerDepth = ROLE_DEPTH[buyerRole] ?? 99;
  const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);

  if (chainRoles.length >= 2 && chainRoles.includes(buyerRole)) {
    return chainRoles.filter((r) => (ROLE_DEPTH[r] ?? 99) < buyerDepth);
  }

  return SUPPLY_CHAIN_ROLES_IN_ORDER.filter((r) => (ROLE_DEPTH[r] ?? 99) < buyerDepth);
}

/** Any upstream tier on the admin chain for this brand that the seller holds. */
export function sellerHasAnyUpstreamRoleForBrand(sellerProfile, buyerRole, brandToken, chainRow) {
  const upstreamRoles = getUpstreamRolesForBuyerOnBrand({ buyerRole, chainRow });
  return upstreamRoles.some((role) => sellerHasRoleForBrand(sellerProfile, role, brandToken));
}

/** Single upstream tier directly above the buyer for this brand (admin chain). */
export function getImmediateUpstreamRoleForBrand({
  profile,
  brandKey,
  chainRow,
  buyerRole,
  parentRolesUnion
}) {
  const role =
    buyerRole || sortRolesByChainDepthDesc(getMySupplierRoles(profile, ''))[0] || null;
  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey,
    chainRow,
    parentRolesUnion
  });
  if (chainRouting?.requiredUpstreamRole) return chainRouting.requiredUpstreamRole;
  const fromSet = pickDisplayRoleFromAllowedSet(allowedRolesSet);
  if (fromSet) return fromSet;
  return role ? PARENT_ROLE_BY_MY_ROLE[role] || null : null;
}

export function getAllowedUpstreamRolesForBrand(opts) {
  const immediate = getImmediateUpstreamRoleForBrand(opts);
  if (immediate) return new Set([immediate]);
  const { allowedRolesSet } = buildAllowedUpstreamRolesSet({
    profile: opts.profile,
    brandKey: opts.brandKey,
    chainRow: opts.chainRow,
    parentRolesUnion: opts.parentRolesUnion
  });
  return allowedRolesSet;
}

/**
 * Seller has this supply-chain role for the given brand (role entry brand overlap or legacy profile).
 */
export function sellerHasRoleForBrand(sellerProfile, role, brandToken) {
  if (!sellerProfile || !role || !brandToken) return false;
  if (!userHasSupplierRole(sellerProfile, role)) return false;

  const viewerTokens = new Set(parseBrandTokens(brandToken));
  if (viewerTokens.size === 0) return false;

  const entries = Array.isArray(sellerProfile.companyInfoEntries)
    ? sellerProfile.companyInfoEntries
    : sellerProfile.companyInfoEntries && typeof sellerProfile.companyInfoEntries === 'object'
      ? [sellerProfile.companyInfoEntries]
      : [];

  const roleEntries = entries.filter((e) => e && e.role === role);
  if (roleEntries.length > 0) {
    return roleEntries.some((e) => entryOverlapsViewerBrands(e, viewerTokens));
  }

  if (sellerProfile.supplierRole === role) {
    return entryOverlapsViewerBrands({ brands: sellerProfile.brands || '' }, viewerTokens);
  }

  return false;
}

/** Role this seller uses for a product brand among allowed upstream tiers (admin chain for that brand). */
export function pickUpstreamSellerRoleForBrand(
  sellerProfile,
  allowedRolesSet,
  brandToken,
  chainRouting = {}
) {
  if (!sellerProfile || !brandToken) return null;
  const ordered = [...(allowedRolesSet || [])].sort(
    (a, b) => (ROLE_DEPTH[b] ?? -1) - (ROLE_DEPTH[a] ?? -1)
  );
  for (const role of ordered) {
    if (sellerHasRoleForBrand(sellerProfile, role, brandToken)) return role;
  }
  return null;
}

export function sellerMatchesUpstreamForBrand(
  sellerProfile,
  allowedRolesSet,
  brandToken,
  chainRouting = {}
) {
  return !!pickUpstreamSellerRoleForBrand(sellerProfile, allowedRolesSet, brandToken, chainRouting);
}

/**
 * Build upstream partner groups: one immediate tier above the buyer, per brand. Empty tiers are omitted.
 */
export async function buildSupplyChainPartnerGroups({
  effectiveViewerProfile,
  allSupplierRows,
  supabase
}) {
  const myRoles = getMySupplierRoles(effectiveViewerProfile, '');
  if (myRoles.length === 0) return [];

  const sortedMyRoles = sortRolesByChainDepthDesc(myRoles);
  const allBrandTokens = new Set();
  for (const role of sortedMyRoles) {
    getViewerBrandTokensForRole(effectiveViewerProfile, role).forEach((t) => allBrandTokens.add(t));
  }

  const adminBrandChainMap = await loadAdminBrandChainsByName({
    supabase,
    brandNames: [...allBrandTokens]
  });
  const parentRolesUnion = getImmediateParentRolesUnion(effectiveViewerProfile);
  const partnerGroups = [];
  const seenGroupKey = new Set();

  for (const myRole of sortedMyRoles) {
    const brandTokens = [...getViewerBrandTokensForRole(effectiveViewerProfile, myRole)].sort((a, b) =>
      a.localeCompare(b)
    );

    for (const brandToken of brandTokens) {
      const brandKey = normalizeBrandKey(brandToken);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const parentRole = getImmediateUpstreamRoleForBrand({
        profile: effectiveViewerProfile,
        brandKey,
        chainRow,
        buyerRole: myRole,
        parentRolesUnion
      });
      if (!parentRole) continue;

      const groupKey = `${myRole}|${brandKey}|${parentRole}`;
      if (seenGroupKey.has(groupKey)) continue;
      seenGroupKey.add(groupKey);

      const viewerBrandSet = new Set(parseBrandTokens(brandToken));
      const partners = (allSupplierRows || [])
        .map((u) => {
          if (!u?.profile || !sellerHasRoleForBrand(u.profile, parentRole, brandToken)) return null;
          return mapSupplyChainPartner(u, parentRole, viewerBrandSet, { filterByBrand: true });
        })
        .filter(Boolean);

      if (partners.length === 0) continue;

      const label = SUPPLY_CHAIN_ROLE_LABELS[parentRole] || parentRole;
      partnerGroups.push({
        yourRole: myRole,
        yourRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[myRole] || myRole,
        brand: brandToken,
        brandKey,
        parentRole,
        parentRoleLabel: label,
        partners,
        message: null
      });
    }
  }

  return partnerGroups;
}
