export const DISCOVERY_PATH = '/product-discovery';

const DETAIL_PATH_PATTERN = /^\/product-discovery\/[^/?]+/;

export function resolveDiscoveryReturnPath(searchParams) {
  const raw = String(searchParams?.get?.('return') || '').trim();
  if (!raw.startsWith(DISCOVERY_PATH) || DETAIL_PATH_PATTERN.test(raw)) {
    return DISCOVERY_PATH;
  }
  return raw;
}

export function buildProductDetailUrl(productId, returnPath = null) {
  const id = String(productId || '').trim();
  if (!id) return null;

  const params = new URLSearchParams();
  const resolvedReturn =
    returnPath || `${window.location.pathname}${window.location.search}`;
  if (resolvedReturn.startsWith(DISCOVERY_PATH) && !DETAIL_PATH_PATTERN.test(resolvedReturn)) {
    params.set('return', resolvedReturn);
  } else {
    params.set('return', DISCOVERY_PATH);
  }

  const query = params.toString();
  return `${window.location.origin}${DISCOVERY_PATH}/${encodeURIComponent(id)}?${query}`;
}

export function openProductDetailInNewTab(productId, returnPath = null) {
  const url = buildProductDetailUrl(productId, returnPath);
  if (!url) return;
  window.open(url, '_blank');
}

/** Close detail tab when opened from discovery; otherwise navigate back in-place. */
export function returnToDiscovery({ navigate, searchParams }) {
  const returnPath = resolveDiscoveryReturnPath(searchParams);

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
