/**
 * Select yourself — brand layer contract (frontend)
 * -----------------------------------------------
 * Mirror of backend/services/supplierBrandLayerContract.js
 *
 * Layer 1 — CATALOG: Select brand dropdown (approved-catalog API)
 *   Source: brands.status === 'approved' only (Admin Brand Approvals).
 * Layer 2 — SUPPLIER ACCESS: may configure role / use brand
 * Layer 3 — ROLES: admin supply-chain stages (chain-role-options API)
 *
 * Do not treat catalog membership, request status, and role availability as one field.
 * Supply-chain definition alone is never brand approval.
 */

import { brandKeyForDuplicateCheck } from './supplierChainEntryValidation';

function isDuplicateOfApprovedRejection(reason = '') {
  return /duplicate of approved brand/i.test(String(reason || ''));
}

function buildApprovedKeys(supplierApprovedBrands = []) {
  const keys = new Set();
  for (const item of Array.isArray(supplierApprovedBrands) ? supplierApprovedBrands : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    const status =
      typeof item === 'object' ? String(item?.status || 'approved').trim().toLowerCase() : 'approved';
    if (!name || (status && status !== 'approved')) continue;
    const key = brandKeyForDuplicateCheck(name);
    if (key) keys.add(key);
  }
  return keys;
}

function buildRejectedKeys(supplierBrandRequests = []) {
  const keys = new Set();
  for (const item of Array.isArray(supplierBrandRequests) ? supplierBrandRequests : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    const status =
      typeof item === 'object' ? String(item?.status || '').trim().toLowerCase() : '';
    if (!name || status !== 'rejected') continue;
    if (typeof item === 'object' && isDuplicateOfApprovedRejection(item?.rejectionReason)) continue;
    const key = brandKeyForDuplicateCheck(name);
    if (key) keys.add(key);
  }
  return keys;
}

function catalogEntryForBrand(brandName, catalogBrands = []) {
  const brandKey = brandKeyForDuplicateCheck(brandName);
  if (!brandKey) return null;
  for (const item of Array.isArray(catalogBrands) ? catalogBrands : []) {
    const name = typeof item === 'string' ? item : item?.name;
    if (brandKeyForDuplicateCheck(name) === brandKey) return item;
  }
  return null;
}

/**
 * Resolve Layer 1–3 for the supplier UI.
 * `brandMeta` is Layer 3 API payload (may include approvalStatus / canSelectRoles).
 */
export function resolveSupplierBrandSetupLayers({
  brandName,
  catalogBrands = [],
  supplierApprovedBrands = [],
  supplierBrandRequests = [],
  brandMeta = null
} = {}) {
  const brand = String(brandName || '').trim();
  const brandKey = brandKeyForDuplicateCheck(brand);
  const rejected = brandKey ? buildRejectedKeys(supplierBrandRequests).has(brandKey) : false;
  const approvedKeys = buildApprovedKeys(supplierApprovedBrands);
  const catalogItem = catalogEntryForBrand(brand, catalogBrands);
  const catalogStatus =
    catalogItem && typeof catalogItem === 'object'
      ? String(catalogItem.status || 'approved').toLowerCase()
      : catalogItem
        ? 'approved'
        : '';
  const inApprovedCatalog =
    !!catalogItem && (!catalogStatus || catalogStatus === 'approved');
  const catalogHasAdminSupplyChain =
    !!catalogItem && typeof catalogItem === 'object' && catalogItem.hasAdminSupplyChain === true;

  const metaApprovalStatus = String(
    brandMeta?.approvalStatus || brandMeta?.status || ''
  )
    .trim()
    .toLowerCase();
  const metaCanSelectRoles =
    typeof brandMeta?.canSelectRoles === 'boolean' ? brandMeta.canSelectRoles : null;
  const metaHasChain =
    typeof brandMeta?.hasSupplyChainDefinition === 'boolean'
      ? brandMeta.hasSupplyChainDefinition
      : null;
  const metaInCatalog =
    typeof brandMeta?.inApprovedCatalog === 'boolean' ? brandMeta.inApprovedCatalog : null;

  // Layer 1
  const layerCatalog = metaInCatalog != null ? metaInCatalog : inApprovedCatalog;

  // Layer 2 — never let stale pending meta override an approved list / catalog access.
  let supplierHasAccess = false;
  if (rejected) {
    supplierHasAccess = false;
  } else if (brandKey && approvedKeys.has(brandKey)) {
    supplierHasAccess = true;
  } else if (layerCatalog) {
    supplierHasAccess = true;
  } else if (metaApprovalStatus === 'approved') {
    supplierHasAccess = true;
  } else if (metaApprovalStatus === 'pending' || metaApprovalStatus === 'rejected') {
    supplierHasAccess = false;
  }

  // Layer 3 — roles unlock from access + chain definition.
  // Treat API canSelectRoles=true as authoritative unlock; do not let a stale
  // canSelectRoles=false override local Layer 2 access + known chain/roles.
  const hasSupplyChainDefinition =
    metaHasChain === true ||
    catalogHasAdminSupplyChain ||
    (Array.isArray(brandMeta?.roles) && brandMeta.roles.length > 0);
  const canSelectRoles =
    supplierHasAccess &&
    (metaCanSelectRoles === true ||
      (hasSupplyChainDefinition &&
        (metaCanSelectRoles == null ||
          layerCatalog ||
          (brandKey && approvedKeys.has(brandKey)) ||
          (Array.isArray(brandMeta?.roles) && brandMeta.roles.length > 0))));

  return {
    brandKey,
    // Layer 1
    inApprovedCatalog: layerCatalog,
    // Layer 2
    supplierHasAccess,
    approvalStatus: rejected
      ? 'rejected'
      : supplierHasAccess
        ? 'approved'
        : metaApprovalStatus || 'missing',
    // Layer 3
    hasSupplyChainDefinition: !!hasSupplyChainDefinition,
    canSelectRoles,
    roles: Array.isArray(brandMeta?.roles) ? brandMeta.roles : []
  };
}

/** Layer 2 helper used by Step 2 gates. */
export function supplierHasBrandAccess(args) {
  return resolveSupplierBrandSetupLayers(args).supplierHasAccess;
}

/** Layer 3 helper used by role picker enablement. */
export function supplierCanSelectBrandRoles(args) {
  return resolveSupplierBrandSetupLayers(args).canSelectRoles;
}
