/**
 * Supplier-submitted copy vs admin-published catalog copy.
 * - supplierDescription: raw text from supplier (attributes JSONB)
 * - products.description: customer-facing copy curated by admin
 */

export function getSupplierSubmittedDescription(attributes = {}) {
  if (!attributes || typeof attributes !== 'object') return '';
  const fromDedicated = String(attributes.supplierDescription || '').trim();
  if (fromDedicated) return fromDedicated;
  return String(attributes.description || '').trim();
}

export function getPublishedCatalogDescription(product = {}) {
  return String(product?.description || '').trim();
}

export function buildSupplierDescriptionAttributes(existingAttributes = {}, supplierText = '') {
  const next = { ...(existingAttributes || {}) };
  const trimmed = String(supplierText || '').trim();
  next.supplierDescription = trimmed;
  // Keep legacy key in sync for older code paths that read attributes.description.
  next.description = trimmed;
  return next;
}
