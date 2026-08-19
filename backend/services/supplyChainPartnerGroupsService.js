import {
  getViewerBrandTokensForRole,
  parseBrandTokens,
  roleDeclaresBrand
} from './supplierBrandGuardService.js';
import {
  buildAllowedUpstreamRolesSet,
  getImmediateParentRolesUnion,
  getMySupplierRoles,
  loadAdminBrandChainsByName,
  PARENT_ROLE_BY_MY_ROLE,
  pickDisplayRoleFromAllowedSet,
  resolveBuyerRoleForBrand,
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
import {
  normalizeBrandKeyFromAttributes,
  resolveUpstreamBrandLabel
} from './supplierBrandGuardService.js';

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
  const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);
  const hasAdminChain = chainRoles.length >= 2;
  const role =
    buyerRole || sortRolesByChainDepthDesc(getMySupplierRoles(profile, ''))[0] || null;
  const { chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey,
    chainRow,
    parentRolesUnion,
    buyerRoleHint: role
  });
  if (chainRouting?.requiredUpstreamRole) return chainRouting.requiredUpstreamRole;
  if (hasAdminChain) return null;
  return role ? PARENT_ROLE_BY_MY_ROLE[role] || null : null;
}

export function formatUpstreamRoleLabel(role) {
  if (!role) return null;
  return SUPPLY_CHAIN_ROLE_LABELS[role] || role;
}

export function formatUpstreamRoleLabels(roles = []) {
  return [...new Set((roles || []).filter(Boolean))]
    .sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99))
    .map((role) => formatUpstreamRoleLabel(role))
    .filter(Boolean)
    .join(', ');
}

/** Admin-chain context for one of the buyer's selected offers (upstream suggestions / inventory). */
export function buildUpstreamChainContextForMineOffer({
  profile,
  mineOffer,
  adminBrandChainMap,
  parentRolesUnion
}) {
  const brandLabel = resolveUpstreamBrandLabel(mineOffer?.attributes, mineOffer?.product?.brand);
  const brandKey = normalizeBrandKeyFromAttributes(brandLabel);
  const chainRow = adminBrandChainMap?.get?.(brandKey) || null;
  const buyerRole = resolveBuyerRoleForBrand(profile, brandLabel || brandKey);
  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey,
    chainRow,
    parentRolesUnion,
    buyerRoleHint: buyerRole
  });
  const requiredUpstreamRole = chainRouting.requiredUpstreamRole || null;

  return {
    brandLabel,
    brandKey,
    chainRow,
    buyerRole,
    allowedRolesSet,
    requiredUpstreamRole,
    requiredUpstreamRoleLabel: formatUpstreamRoleLabel(requiredUpstreamRole),
    chainRouting: {
      source: chainRouting.source,
      brand: chainRow?.category_name || brandLabel || null,
      buyerRole: chainRouting.buyerRole || buyerRole || null,
      requiredUpstreamRole: requiredUpstreamRole || chainRouting.requiredUpstreamRole || null,
      chainRoles: chainRouting.chainRoles || normalizeChainRolesFromStages(chainRow?.stages)
    }
  };
}

/**
 * Empty-offer copy for upstream sourcing.
 * Every path starts with the same "cannot be sourced" headline, then a reason that
 * distinguishes missing listings, wrong supply-chain layer, brand mismatch, etc.
 */
export function buildNoUpstreamOffersMessage(ctx = {}) {
  const brandLabel = String(ctx.brandLabel || ctx.chainRouting?.brand || '').trim();
  const brandText = brandLabel ? `"${brandLabel}"` : 'this brand';
  const layerLabel =
    ctx.requiredUpstreamRoleLabel ||
    formatUpstreamRoleLabel(ctx.requiredUpstreamRole || ctx.chainRouting?.requiredUpstreamRole) ||
    '';
  const reason = String(ctx.reason || '').trim();
  const registeredNames = (Array.isArray(ctx.registeredPartnerNames) ? ctx.registeredPartnerNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const registeredText = registeredNames.length ? ` (${registeredNames.join(', ')})` : '';
  const headline = layerLabel
    ? `This product cannot be sourced from ${layerLabel} for ${brandText}.`
    : `This product cannot be sourced for ${brandText}.`;
  const layerOrFallback = layerLabel || 'the allowed upstream layer';

  if (reason === 'wrong_layer') {
    const registeredHint = registeredNames.length
      ? ` Your registered upstream partner(s)${registeredText} also do not list this exact variant with stock.`
      : '';
    return `${headline} Other suppliers list this product with stock, but none are ${layerOrFallback} — the only layer allowed to sell to you on this brand's chain.${registeredHint}`;
  }

  if (reason === 'registered_failed_validation') {
    return `${headline} Your registered upstream partner(s)${registeredText} list this product, but they do not match the ${layerOrFallback} layer or brand on Who are you.`;
  }

  if (reason === 'brand_mismatch') {
    return `${headline} Listings exist, but none match brand ${brandText}.`;
  }

  if (reason === 'ranking_empty') {
    return `${headline} Eligible partners were found, but none remained after ranking.`;
  }

  if (reason === 'no_listings' || layerLabel) {
    return layerLabel
      ? `${headline} No ${layerLabel} currently list this product with stock. Ask your ${layerLabel} to add it.`
      : `${headline} No eligible upstream partner currently lists this product with stock.`;
  }

  if (Array.isArray(ctx.chainRouting?.chainRoles) && ctx.chainRouting.chainRoles.length >= 2) {
    return `${headline} Your admin supply chain is defined, but your role could not be matched to it — check Who are you.`;
  }

  return `${headline} Ask admin to define the supply chain in Admin → Supply Chain, then ensure your upstream partner registers at the correct layer.`;
}

export function collectRequiredUpstreamRolesFromContexts(contexts = []) {
  return [
    ...new Set(
      (contexts || [])
        .map((ctx) => ctx?.requiredUpstreamRole || ctx?.chainRouting?.requiredUpstreamRole)
        .filter(Boolean)
    )
  ].sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99));
}

export function getAllowedUpstreamRolesForBrand(opts) {
  const { allowedRolesSet } = buildAllowedUpstreamRolesSet({
    profile: opts.profile,
    brandKey: opts.brandKey,
    chainRow: opts.chainRow,
    parentRolesUnion: opts.parentRolesUnion,
    buyerRoleHint: opts.buyerRole
  });
  return allowedRolesSet;
}

/**
 * Seller has this supply-chain role for the given brand (role entry brand overlap or legacy profile).
 */
export function sellerHasRoleForBrand(sellerProfile, role, brandToken) {
  if (!sellerProfile || !role || !brandToken) return false;
  if (!userHasSupplierRole(sellerProfile, role)) return false;
  return roleDeclaresBrand(sellerProfile, role, brandToken);
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

/** Pick nearest upstream role the seller holds on the admin chain for this brand. */
export function pickAnyUpstreamSellerRoleOnChain(sellerProfile, buyerRole, brandToken, chainRow) {
  const upstreamRoles = getUpstreamRolesForBuyerOnBrand({ buyerRole, chainRow });
  const ordered = [...upstreamRoles].sort((a, b) => (ROLE_DEPTH[b] ?? -1) - (ROLE_DEPTH[a] ?? -1));
  for (const role of ordered) {
    if (sellerHasRoleForBrand(sellerProfile, role, brandToken)) return role;
  }
  return null;
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

/**
 * Supplier user ids registered as immediate upstream partners per brand (same rules as Profile).
 */
export function buildRegisteredUpstreamPartnerIdsByBrandKey({
  buyerProfile,
  adminBrandChainMap,
  upstreamUsers,
  parentRolesUnion
}) {
  const map = new Map();
  const myRoles = sortRolesByChainDepthDesc(getMySupplierRoles(buyerProfile, ''));
  for (const myRole of myRoles) {
    const brandTokens = [...getViewerBrandTokensForRole(buyerProfile, myRole)];
    for (const brandToken of brandTokens) {
      const brandKey = normalizeBrandKey(brandToken);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const parentRole = getImmediateUpstreamRoleForBrand({
        profile: buyerProfile,
        brandKey,
        chainRow,
        buyerRole: myRole,
        parentRolesUnion
      });
      if (!parentRole) continue;
      for (const u of upstreamUsers || []) {
        if (!u?.id || !u?.profile) continue;
        if (!sellerHasRoleForBrand(u.profile, parentRole, brandToken)) continue;
        if (!map.has(brandKey)) map.set(brandKey, new Set());
        map.get(brandKey).add(u.id);
      }
    }
  }
  return map;
}
