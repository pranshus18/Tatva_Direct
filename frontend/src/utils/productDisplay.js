const PLACEHOLDER_DESCRIPTIONS = new Set([
  '(not set)',
  'n/a',
  'na',
  'none',
  '-',
  '—',
  'null',
  'undefined',
  'tbd',
  'to be added',
  'not available',
  'no description'
]);

export function looksLikeSpecificationDump(text) {
  const lines = String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const specLikeLines = lines.filter((line) => /^[\w\s/&().-]+\s*:\s*.+/.test(line));
  return specLikeLines.length >= Math.max(2, Math.ceil(lines.length * 0.5));
}

/** Hide legacy AI-instruction text that was saved in the description field. */
export function looksLikeAiInstructions(text) {
  if (!text || !String(text).trim()) return false;
  return /\b(give me|generate all|extract|list all|supplier can fill|specification keys?|ai fetch|from a customer point of view)\b/i.test(
    String(text)
  );
}

/** True only for buyer-facing prose descriptions, not placeholders, prompts, or spec dumps. */
export function isMeaningfulProductDescription(text, { allowInlineSpecs = false } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_DESCRIPTIONS.has(trimmed.toLowerCase())) return false;
  if (looksLikeAiInstructions(trimmed)) return false;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return false;
  if (!allowInlineSpecs && looksLikeSpecificationDump(trimmed)) return false;
  return true;
}

/** Pick the first dedicated product description field suitable for buyers. */
export function resolveCustomerProductDescription(...candidates) {
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (isMeaningfulProductDescription(trimmed)) return trimmed;
  }
  return '';
}

/** Raw supplier submission for admin review — never the admin-published catalog copy. */
export function getAdminSupplierSubmittedDescription(product = {}) {
  return String(product?.supplierDescription || '').trim();
}

/**
 * Buyer-facing description shown in the admin edit box.
 * Pending/rejected: only admin-saved published copy (offer.publishedDescription), not stale catalog text.
 * Approved: catalog products.description.
 */
export function getAdminBuyerFacingCatalogDescription(product = {}) {
  const status = String(product?.status || 'pending').trim().toLowerCase();
  const publishedFromOffer = String(product?.publishedDescription || '').trim();
  const catalog = String(product?.description || '').trim();
  const supplier = getAdminSupplierSubmittedDescription(product);

  const isDistinctBuyerFacing = (text) => {
    const trimmed = String(text || '').trim();
    if (!isMeaningfulProductDescription(trimmed, { allowInlineSpecs: true })) return false;
    if (supplier && trimmed === supplier) return false;
    return true;
  };

  if (status === 'approved') {
    return isDistinctBuyerFacing(catalog) ? catalog : '';
  }

  if (isDistinctBuyerFacing(publishedFromOffer)) {
    return publishedFromOffer;
  }

  // After admin Save, catalog.description and offer.publishedDescription should match.
  if (
    isDistinctBuyerFacing(catalog) &&
    publishedFromOffer &&
    catalog === publishedFromOffer
  ) {
    return catalog;
  }

  return '';
}

/** Admin list cards: prefer saved buyer-facing copy; else supplier draft while pending. */
export function getAdminReviewProductDescription(product = {}) {
  const buyerFacing = getAdminBuyerFacingCatalogDescription(product);
  if (buyerFacing) return buyerFacing;

  const status = String(product?.status || 'pending').trim().toLowerCase();
  const supplierDraft = getAdminSupplierSubmittedDescription(product);
  if (status !== 'approved' && supplierDraft) {
    return supplierDraft;
  }
  return '';
}

/** Supplier portal: show admin-polished copy when available, else the supplier draft. */
export function resolveSupplierPortalDisplayDescription(product = {}) {
  const published = String(product?.publishedDescription || '').trim();
  if (isMeaningfulProductDescription(published, { allowInlineSpecs: true })) {
    return published;
  }
  return String(product?.supplierDescription || product?.description || '').trim();
}

export function supplierPortalHasPublishedDescription(product = {}) {
  const published = String(product?.publishedDescription || '').trim();
  return isMeaningfulProductDescription(published, { allowInlineSpecs: true });
}

/** Product description for discovery detail: active variant first, then shared catalog copy. */
export function resolveDiscoveryProductDescription(productSummary = {}, activeListing = {}) {
  const candidates = [
    activeListing?.publishedDescription,
    activeListing?.description,
    activeListing?.supplierDescription,
    productSummary?.publishedDescription,
    productSummary?.description
  ];
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (isMeaningfulProductDescription(trimmed, { allowInlineSpecs: true })) return trimmed;
  }
  return '';
}
