/**
 * Supplier-submitted copy vs admin-published catalog copy.
 * - supplierDescription: raw text from supplier (attributes JSONB)
 * - products.description: customer-facing copy curated by admin
 */

export function getSupplierSubmittedDescription(attributes = {}) {
  if (!attributes || typeof attributes !== 'object') return '';
  const fromDedicated = String(attributes.supplierDescription || '').trim();
  if (fromDedicated) return fromDedicated;
  // Legacy rows may only have attributes.description from supplier submission era.
  return String(attributes.description || '').trim();
}

export function getPublishedCatalogDescription(product = {}) {
  return String(product?.description || '').trim();
}

export function getAdminPublishedOfferDescription(attributes = {}) {
  if (!attributes || typeof attributes !== 'object') return '';
  return String(attributes.publishedDescription || '').trim();
}

/** Buyer-facing description: admin-published catalog copy, else offer publish, else supplier submission. */
export function resolveBuyerFacingProductDescription({ product = {}, offerAttributes = {} } = {}) {
  const fromCatalog = getPublishedCatalogDescription(product);
  if (fromCatalog) return fromCatalog;
  const fromOffer = getAdminPublishedOfferDescription(offerAttributes);
  if (fromOffer) return fromOffer;
  return getSupplierSubmittedDescription(offerAttributes);
}

/** Mirrors admin UI: saved buyer-facing copy before approval (AI polish optional). */
export function getAdminBuyerFacingDescriptionForApproval(product = {}) {
  const status = String(product?.status || 'pending').trim().toLowerCase();
  const publishedFromOffer = String(product?.publishedDescription || '').trim();
  const catalog = String(product?.description || '').trim();

  if (status === 'approved') {
    return catalog;
  }

  // Admin explicitly saved copy on the offer — may match supplier draft if admin approved as-is.
  if (publishedFromOffer) {
    return publishedFromOffer;
  }

  // Catalog + offer publish synced after save (legacy responses).
  if (catalog && publishedFromOffer && catalog === publishedFromOffer) {
    return catalog;
  }

  return '';
}

/** Supplier portal writes — sets immutable supplier draft on the offer. */
export function buildSupplierDescriptionAttributes(existingAttributes = {}, supplierText = '') {
  const next = { ...(existingAttributes || {}) };
  const trimmed = String(supplierText || '').trim();
  next.supplierDescription = trimmed;
  // Keep legacy key in sync for older code paths that read attributes.description.
  next.description = trimmed;
  return next;
}

/** Admin catalog save — stores buyer-facing copy without overwriting supplier draft. */
export function buildAdminPublishedDescriptionAttributes(existingAttributes = {}, publishedText = '') {
  const next = { ...(existingAttributes || {}) };
  next.publishedDescription = String(publishedText || '').trim();
  return next;
}
