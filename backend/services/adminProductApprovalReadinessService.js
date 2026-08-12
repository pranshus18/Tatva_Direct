import {
  getAdminBuyerFacingDescriptionForApproval
} from '../utils/supplierProductDescriptions.js';
import { parseSpecificationsObject } from './supplierCatalogHelpersService.js';
import { validateAndNormalizeTaxRates } from '../controllers/supplier/shared/productHelpers.js';

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

function looksLikeAiInstructions(text) {
  if (!text || !String(text).trim()) return false;
  return /\b(give me|generate all|extract|list all|supplier can fill|specification keys?|ai fetch|from a customer point of view)\b/i.test(
    String(text)
  );
}

function isMeaningfulProductDescription(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_DESCRIPTIONS.has(trimmed.toLowerCase())) return false;
  if (looksLikeAiInstructions(trimmed)) return false;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return false;
  return true;
}

function normalizeHsnCode(product = {}) {
  return String(product.hsn_code || product.hsnCode || '').trim();
}

function countSpecificationKeys(specifications) {
  const specs = parseSpecificationsObject(specifications) || {};
  return Object.keys(specs).filter((key) => String(key || '').trim()).length;
}

/** Merge supplier offer GST/HSN onto catalog product row for approval checks. */
export function mergeOfferIntoProductForApproval(product = {}, offerRow = null) {
  if (!offerRow) return product;
  const attrs = offerRow.attributes && typeof offerRow.attributes === 'object' ? offerRow.attributes : {};
  const hsnCode =
    product.hsn_code ||
    product.hsnCode ||
    attrs.hsnCode ||
    attrs.hsn_code ||
    null;

  return {
    ...product,
    supplierDescription:
      attrs.supplierDescription ||
      attrs.description ||
      product.supplierDescription ||
      '',
    publishedDescription:
      attrs.publishedDescription ||
      product.publishedDescription ||
      '',
    igst_rate: product.igst_rate ?? offerRow.igst_rate ?? attrs.igstRate ?? null,
    cgst_rate: product.cgst_rate ?? offerRow.cgst_rate ?? attrs.cgstRate ?? null,
    sgst_rate: product.sgst_rate ?? offerRow.sgst_rate ?? attrs.sgstRate ?? null,
    hsn_code: hsnCode,
    hsnCode: hsnCode
  };
}

/** Admin catalog products need description, GST, and specification keys before approval. */
export function validateAdminProductApprovalReadiness(product = {}) {
  const missingRequirements = [];

  const buyerFacingDescription = getAdminBuyerFacingDescriptionForApproval(product);

  if (!isMeaningfulProductDescription(buyerFacingDescription)) {
    missingRequirements.push({
      id: 'description',
      label: 'Product description',
      message:
        'Add a product description (supplier text is enough if it looks good, or edit / Polish with AI).'
    });
  }

  const hsnCode = normalizeHsnCode(product);
  if (!hsnCode || !/^\d{4,8}$/.test(hsnCode)) {
    missingRequirements.push({
      id: 'gst_hsn',
      label: 'HSN code',
      message: 'Set and save a valid HSN code (4–8 digits) using GST AI Chat or manual entry.'
    });
  }

  const igstRate = product.igst_rate ?? product.igstRate;
  const cgstRate = product.cgst_rate ?? product.cgstRate;
  const sgstRate = product.sgst_rate ?? product.sgstRate;
  const hasAnyRate = [igstRate, cgstRate, sgstRate].some(
    (value) => value !== null && value !== undefined && value !== ''
  );

  if (!hasAnyRate) {
    missingRequirements.push({
      id: 'gst_rates',
      label: 'GST rates',
      message: 'Set and save IGST, CGST, and SGST rates before approval.'
    });
  } else {
    const taxValidation = validateAndNormalizeTaxRates({
      igst_rate: igstRate,
      cgst_rate: cgstRate,
      sgst_rate: sgstRate
    });
    if (!taxValidation.ok) {
      missingRequirements.push({
        id: 'gst_rates',
        label: 'GST rates',
        message: taxValidation.message || 'Set and save IGST, CGST, and SGST rates before approval.'
      });
    }
  }

  const specKeyCount = countSpecificationKeys(product.specifications);
  if (specKeyCount === 0) {
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
  return validateAdminProductApprovalReadiness(product).ok;
}
