import {
  getAdminBuyerFacingCatalogDescription,
  getAdminSupplierSubmittedDescription,
  isMeaningfulProductDescription
} from './productDisplay';
import { parseSpecificationsObject } from './specifications';

const IGST_ALLOWED = new Set(['0', '5', '12', '18', '28']);
const CGST_SGST_ALLOWED = new Set(['0', '2.5', '6', '9', '14']);

function parseTaxRate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return NaN;
  return Number(parsed.toFixed(2));
}

function validateGstRates(product = {}) {
  const igstRate = parseTaxRate(product.igst_rate ?? product.igstRate);
  const cgstRate = parseTaxRate(product.cgst_rate ?? product.cgstRate);
  const sgstRate = parseTaxRate(product.sgst_rate ?? product.sgstRate);

  if ([igstRate, cgstRate, sgstRate].some((v) => Number.isNaN(v))) {
    return { ok: false, message: 'Invalid tax rate value.' };
  }
  if (igstRate === null || cgstRate === null || sgstRate === null) {
    return { ok: false, message: 'IGST, CGST, and SGST are all required together.' };
  }
  if (!IGST_ALLOWED.has(String(igstRate))) {
    return { ok: false, message: 'Invalid IGST rate.' };
  }
  if (!CGST_SGST_ALLOWED.has(String(cgstRate)) || !CGST_SGST_ALLOWED.has(String(sgstRate))) {
    return { ok: false, message: 'Invalid CGST/SGST rate.' };
  }
  if (cgstRate !== sgstRate) {
    return { ok: false, message: 'CGST and SGST must match.' };
  }
  if (Number((cgstRate + sgstRate).toFixed(2)) !== igstRate) {
    return { ok: false, message: 'IGST must equal CGST + SGST.' };
  }
  return { ok: true, message: '' };
}

/** Match backend admin readiness: parse JSON strings and unwrap { snapshot: {...} }. */
function countSpecificationKeys(specifications) {
  const specs = parseSpecificationsObject(specifications) || {};
  return Object.keys(specs).filter((key) => String(key || '').trim()).length;
}

/** Description used for approval: saved buyer copy, else supplier draft (polish optional). */
export function getDescriptionForAdminApproval(product = {}) {
  const saved = getAdminBuyerFacingCatalogDescription(product);
  if (isMeaningfulProductDescription(saved, { allowInlineSpecs: true })) {
    return saved;
  }
  const supplier = getAdminSupplierSubmittedDescription(product);
  if (isMeaningfulProductDescription(supplier, { allowInlineSpecs: true })) {
    return supplier;
  }
  return '';
}

/** Admin catalog products need description, GST, and specification keys before approval. */
export function getAdminProductApprovalReadiness(product = {}) {
  const missingRequirements = [];

  const buyerFacingDescription = getDescriptionForAdminApproval(product);

  if (!isMeaningfulProductDescription(buyerFacingDescription, { allowInlineSpecs: true })) {
    missingRequirements.push({
      id: 'description',
      label: 'Product description',
      message:
        'Add a product description (supplier text is enough if it looks good, or edit / Polish with AI).'
    });
  }

  const hsnCode = String(product.hsnCode || product.hsn_code || '').trim();
  if (!hsnCode || !/^\d{4,8}$/.test(hsnCode)) {
    missingRequirements.push({
      id: 'gst_hsn',
      label: 'HSN code',
      message: 'Set and save a valid HSN code (4–8 digits) using GST AI Chat or manual entry.'
    });
  }

  const taxValidation = validateGstRates(product);
  if (!taxValidation.ok) {
    missingRequirements.push({
      id: 'gst_rates',
      label: 'GST rates',
      message: taxValidation.message || 'Set and save IGST, CGST, and SGST rates before approval.'
    });
  }

  if (countSpecificationKeys(product.specifications) === 0) {
    missingRequirements.push({
      id: 'specifications',
      label: 'Specifications',
      message: 'Generate and save specification keys using AI Fetch before approval.'
    });
  }

  const ok = missingRequirements.length === 0;
  return {
    ok,
    missingRequirements,
    message: ok
      ? ''
      : `Complete before approval: ${missingRequirements.map((row) => row.label).join(', ')}.`
  };
}

export function isAdminProductReadyForApproval(product = {}) {
  return getAdminProductApprovalReadiness(product).ok;
}
