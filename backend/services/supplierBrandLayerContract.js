/**
 * Select yourself — brand layer contract
 * ------------------------------------
 * Keep these layers separate. Do not overload `status` to mean more than brands-table approval.
 *
 * Layer 1 — CATALOG (Select brand dropdown)
 *   Purpose: brands a supplier may pick.
 *   Source: brands.status === 'approved' ONLY (same as Admin → Brand Approvals).
 *   Supply-chain rows only enrich hasAdminSupplyChain on already-approved brands.
 *   API: GET /api/supplier/brands/approved-catalog
 *   Flag: inApprovedCatalog
 *
 * Layer 2 — SUPPLIER ACCESS (may use brand for role setup / products)
 *   Purpose: whether THIS supplier may proceed with the brand.
 *   Path A: brand is in approved catalog (and typically selected).
 *   Path B: this supplier's brand request is approved.
 *   Rejected Path B blocks that brand identity (except duplicate-merge noise).
 *   Profile fields: adminApprovedBrands, supplierBrandRequests
 *   Flag: supplierHasAccess
 *
 * Layer 3 — SUPPLY-CHAIN ROLES (Step 2 role picker)
 *   Purpose: admin-defined roles for a brand.
 *   Source: category_supply_chains.stages ONLY.
 *   Requires: supplierHasAccess && hasSupplyChainDefinition
 *   API: GET /api/profile/supplier/chain-role-options
 *   Flags: hasSupplyChainDefinition, roles, canSelectRoles
 */

import {
  brandKeysMatchForChainLookup,
  catalogBrandDedupKey,
  normalizeBrandKey,
  normalizeChainRolesFromStages
} from '../services/supplyChainSharedService.js';

export const BRAND_APPROVAL_STATUS = Object.freeze({
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
  MISSING: 'missing'
});

function normalizeApprovalStatus(raw) {
  const status = String(raw || '').trim().toLowerCase();
  if (status === BRAND_APPROVAL_STATUS.APPROVED) return BRAND_APPROVAL_STATUS.APPROVED;
  if (status === BRAND_APPROVAL_STATUS.PENDING) return BRAND_APPROVAL_STATUS.PENDING;
  if (status === BRAND_APPROVAL_STATUS.REJECTED) return BRAND_APPROVAL_STATUS.REJECTED;
  return BRAND_APPROVAL_STATUS.MISSING;
}

/**
 * Resolve the three layers for one brand without mutating brands-table truth.
 * @param {{
 *   brandInput: string,
 *   brandRow?: { name?: string, normalized_name?: string, status?: string } | null,
 *   chainRow?: { category_name?: string, stages?: unknown } | null
 * }} args
 */
export function resolveSupplierBrandLayers({ brandInput, brandRow = null, chainRow = null } = {}) {
  const original = String(brandInput || '').trim();
  const normalized = normalizeBrandKey(original);
  const dedupKey = catalogBrandDedupKey(original);

  const roles = normalizeChainRolesFromStages(chainRow?.stages);
  const hasSupplyChainDefinition = roles.length > 0;
  const chainName = String(chainRow?.category_name || '').trim();

  const approvalStatus = normalizeApprovalStatus(brandRow?.status);
  const brandsTableApproved = approvalStatus === BRAND_APPROVAL_STATUS.APPROVED;

  const chainMatchesInput =
    hasSupplyChainDefinition &&
    chainName &&
    dedupKey &&
    (catalogBrandDedupKey(chainName) === dedupKey ||
      brandKeysMatchForChainLookup(dedupKey, catalogBrandDedupKey(chainName)) ||
      brandKeysMatchForChainLookup(normalized, normalizeBrandKey(chainName)));

  // Layer 1: catalog membership (approved row OR admin-defined chain for this identity).
  const inApprovedCatalog = brandsTableApproved || chainMatchesInput;

  // Layer 2: supplier may use this brand when catalog lists it or brands-table says approved.
  // (Caller may still block Path B rejections separately.)
  const supplierHasAccess = inApprovedCatalog || brandsTableApproved;

  // Layer 3: roles come only from admin chain stages.
  const canSelectRoles = supplierHasAccess && hasSupplyChainDefinition;

  const displayBrandName =
    (brandsTableApproved && String(brandRow?.name || '').trim()) ||
    chainName ||
    original;

  return {
    brand: displayBrandName,
    normalizedBrand: normalized,
    dedupKey,
    // Layer 2 truth from brands table — never rewrite pending→approved here.
    approvalStatus,
    // Layer 1
    inApprovedCatalog,
    // Layer 2 gate for this evaluation context
    supplierHasAccess,
    // Layer 3
    hasSupplyChainDefinition,
    roles,
    canSelectRoles,
    // `status` mirrors brands-table approval only (Layer 2 truth).
    // Do NOT set status=approved just because roles exist — use canSelectRoles for that.
    status: approvalStatus
  };
}

export function buildChainRoleOptionsMessage({
  canSelectRoles,
  supplierHasAccess,
  hasSupplyChainDefinition,
  displayBrandName
}) {
  if (canSelectRoles) return null;
  if (!supplierHasAccess) {
    return 'This brand has not yet been approved by the admin. Please wait until the approval is complete before proceeding.';
  }
  if (!hasSupplyChainDefinition) {
    return `Supply chain is not defined by admin for: ${displayBrandName}.`;
  }
  return null;
}
