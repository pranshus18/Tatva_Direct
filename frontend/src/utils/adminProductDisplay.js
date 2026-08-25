import {
  getAdminBuyerFacingCatalogDescription,
  getAdminSupplierSubmittedDescription
} from './productDisplay';
import { parseSpecificationsObject } from './specifications';

/** Admin view/edit: show only the supplier's filled specs, never another product's catalog values. */
export function resolveAdminDisplaySpecifications(product = {}) {
  const offerSpecs = parseSpecificationsObject(product?.supplierOfferSpecifications) || {};
  if (Object.keys(offerSpecs).length > 0) return offerSpecs;
  return parseSpecificationsObject(product?.specifications) || {};
}

/** Admin list/card title: supplier listing name, never a mis-linked catalog title. */
export function getAdminRowDisplayName(product = {}) {
  const baseName =
    String(product?.listingName || '').trim() ||
    String(product?.name || '').trim() ||
    String(product?.catalogName || '').trim() ||
    'Product';
  const variantLabel = String(product?.variantLabel || '').trim();
  if (variantLabel && !product?.identityConflictsWithCatalog) return `${baseName} — ${variantLabel}`;
  return baseName;
}

/** Text sent to Polish with AI: current edit box, then supplier draft, then saved copy. */
export function getAdminPolishSourceText({ product, editedProduct, isEditing }) {
  const typed = isEditing ? String(editedProduct?.description || '').trim() : '';
  if (typed) return typed;
  const supplierDraft = getAdminSupplierSubmittedDescription(product);
  if (supplierDraft) return supplierDraft;
  return getAdminBuyerFacingCatalogDescription(product);
}
