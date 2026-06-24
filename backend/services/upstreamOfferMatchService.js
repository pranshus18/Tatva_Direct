/**
 * Upstream supply-chain offer matching.
 * Retailers order from upstream partners on the same catalog product (TSIN);
 * exact variant match is preferred but not required when tiers align.
 */

export function isExactUpstreamVariantMatch(mineOffer, upstreamOffer) {
  const mineVariantKey = String(mineOffer?.variant_key || '').trim();
  const mineVariantAsin = String(mineOffer?.variant_asin || '').trim();
  const upstreamVariantKey = String(upstreamOffer?.variant_key || '').trim();
  const upstreamVariantAsin = String(upstreamOffer?.variant_asin || '').trim();

  if (mineVariantKey) {
    return Boolean(upstreamVariantKey) && upstreamVariantKey === mineVariantKey;
  }
  if (mineVariantAsin) {
    return Boolean(upstreamVariantAsin) && upstreamVariantAsin === mineVariantAsin;
  }
  return isSameCatalogProductMatch(mineOffer, upstreamOffer);
}

export function isSameCatalogProductMatch(mineOffer, upstreamOffer) {
  const mineProductId = String(mineOffer?.product_id || '').trim();
  const upstreamProductId = String(upstreamOffer?.product_id || '').trim();
  return Boolean(mineProductId) && mineProductId === upstreamProductId;
}

/** `exact_variant` | `catalog_product` | null */
export function getUpstreamOfferMatchType(mineOffer, upstreamOffer) {
  if (isExactUpstreamVariantMatch(mineOffer, upstreamOffer)) return 'exact_variant';
  if (isSameCatalogProductMatch(mineOffer, upstreamOffer)) return 'catalog_product';
  return null;
}

export function upstreamOffersMatchForSupplyChain(mineOffer, upstreamOffer) {
  return getUpstreamOfferMatchType(mineOffer, upstreamOffer) != null;
}

export const UPSTREAM_VARIANT_MATCH_RANK = {
  exact_variant: 0,
  catalog_product: 1
};
