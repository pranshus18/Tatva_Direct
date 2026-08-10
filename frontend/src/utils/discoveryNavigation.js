export const DISCOVERY_PATH = '/product-discovery';
export const UPSTREAM_SOURCING_PATH = '/supplier-upstream';
export const UPSTREAM_PRODUCT_DETAIL_PATH = '/supplier-upstream/product';

const DETAIL_PATH_PATTERN = /^\/product-discovery\/[^/?]+/;
const UPSTREAM_DETAIL_PATH_PATTERN = /^\/supplier-upstream\/product\/[^/?]+/;

function resolveReturnPath(searchParams, listPath, detailPattern) {
  const raw = String(searchParams?.get?.('return') || '').trim();
  if (!raw.startsWith(listPath) || detailPattern.test(raw)) {
    return listPath;
  }
  return raw;
}

function buildDetailUrl({ productId, listPath, detailPath, detailPattern, returnPath, extraParams }) {
  const id = String(productId || '').trim();
  if (!id) return null;

  const params = new URLSearchParams();
  const resolvedReturn = returnPath || `${window.location.pathname}${window.location.search}`;
  params.set(
    'return',
    resolvedReturn.startsWith(listPath) && !detailPattern.test(resolvedReturn)
      ? resolvedReturn
      : listPath
  );
  for (const [key, value] of Object.entries(extraParams || {})) {
    const normalized = String(value ?? '').trim();
    if (normalized) params.set(key, normalized);
  }

  return `${window.location.origin}${detailPath}/${encodeURIComponent(id)}?${params.toString()}`;
}

/** Close the detail tab when it was opened from the list; otherwise navigate back in-place. */
function leaveDetailView({ navigate, returnPath }) {
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.focus();
    } catch {
      // Same-origin focus should succeed; ignore if blocked.
    }
  }

  window.close();

  window.setTimeout(() => {
    navigate(returnPath);
  }, 120);
}

export function resolveDiscoveryReturnPath(searchParams) {
  return resolveReturnPath(searchParams, DISCOVERY_PATH, DETAIL_PATH_PATTERN);
}

export function buildProductDetailUrl(productId, returnPath = null) {
  return buildDetailUrl({
    productId,
    listPath: DISCOVERY_PATH,
    detailPath: DISCOVERY_PATH,
    detailPattern: DETAIL_PATH_PATTERN,
    returnPath
  });
}

export function openProductDetailInNewTab(productId, returnPath = null) {
  const url = buildProductDetailUrl(productId, returnPath);
  if (!url) return;
  window.open(url, '_blank');
}

export function returnToDiscovery({ navigate, searchParams }) {
  leaveDetailView({ navigate, returnPath: resolveDiscoveryReturnPath(searchParams) });
}

export function resolveUpstreamReturnPath(searchParams) {
  return resolveReturnPath(searchParams, UPSTREAM_SOURCING_PATH, UPSTREAM_DETAIL_PATH_PATTERN);
}

/**
 * Upstream sourcing detail link. `mine` carries the supplier's own listing id so the detail page
 * can hand the supplier back to the sourcing flow for exactly that listing.
 * `variant` prefers variantKey, then variantAsin, so the detail page opens the clicked offer
 * even when multiple offers share one catalog products.id.
 */
export function buildUpstreamProductDetailUrl(
  productId,
  { variantKey = '', variantAsin = '', mineSupplierProductId = '', returnPath = null } = {}
) {
  const variantToken = String(variantKey || '').trim() || String(variantAsin || '').trim();
  return buildDetailUrl({
    productId,
    listPath: UPSTREAM_SOURCING_PATH,
    detailPath: UPSTREAM_PRODUCT_DETAIL_PATH,
    detailPattern: UPSTREAM_DETAIL_PATH_PATTERN,
    returnPath,
    extraParams: { variant: variantToken, mine: mineSupplierProductId }
  });
}

export function openUpstreamProductDetailInNewTab(productId, options = {}) {
  const url = buildUpstreamProductDetailUrl(productId, options);
  if (!url) return false;
  return Boolean(window.open(url, '_blank'));
}

export function buildUpstreamSourcingUrl({
  addSupplierProductId = '',
  quantity = ''
} = {}) {
  const mineId = String(addSupplierProductId || '').trim();
  if (!mineId) return UPSTREAM_SOURCING_PATH;
  const params = new URLSearchParams();
  params.set('add', mineId);
  const qty = Number(quantity);
  if (Number.isFinite(qty) && qty >= 1) {
    params.set('qty', String(Math.floor(qty)));
  }
  return `${UPSTREAM_SOURCING_PATH}?${params.toString()}`;
}

export function returnToUpstreamSourcing({ navigate, searchParams }) {
  leaveDetailView({ navigate, returnPath: resolveUpstreamReturnPath(searchParams) });
}
