import { parseSupplierOfferAttributes } from './supplierCatalogHelpersService.js';

const asNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const roundMoney = (value) => Math.round(asNumber(value) * 100) / 100;

const STATE_ALIAS_MAP = new Map([
  ['andhra pradesh', 'andhra pradesh'],
  ['ap', 'andhra pradesh'],
  ['arunachal pradesh', 'arunachal pradesh'],
  ['arunachal', 'arunachal pradesh'],
  ['assam', 'assam'],
  ['as', 'assam'],
  ['bihar', 'bihar'],
  ['br', 'bihar'],
  ['chhattisgarh', 'chhattisgarh'],
  ['cg', 'chhattisgarh'],
  ['goa', 'goa'],
  ['ga', 'goa'],
  ['gujarat', 'gujarat'],
  ['gj', 'gujarat'],
  ['haryana', 'haryana'],
  ['hr', 'haryana'],
  ['himachal pradesh', 'himachal pradesh'],
  ['hp', 'himachal pradesh'],
  ['jharkhand', 'jharkhand'],
  ['jh', 'jharkhand'],
  ['karnataka', 'karnataka'],
  ['ka', 'karnataka'],
  ['kerala', 'kerala'],
  ['kl', 'kerala'],
  ['madhya pradesh', 'madhya pradesh'],
  ['mp', 'madhya pradesh'],
  ['maharashtra', 'maharashtra'],
  ['mh', 'maharashtra'],
  ['manipur', 'manipur'],
  ['mn', 'manipur'],
  ['meghalaya', 'meghalaya'],
  ['ml', 'meghalaya'],
  ['mizoram', 'mizoram'],
  ['mz', 'mizoram'],
  ['nagaland', 'nagaland'],
  ['nl', 'nagaland'],
  ['odisha', 'odisha'],
  ['orissa', 'odisha'],
  ['od', 'odisha'],
  ['punjab', 'punjab'],
  ['pb', 'punjab'],
  ['rajasthan', 'rajasthan'],
  ['rj', 'rajasthan'],
  ['sikkim', 'sikkim'],
  ['sk', 'sikkim'],
  ['tamil nadu', 'tamil nadu'],
  ['tn', 'tamil nadu'],
  ['telangana', 'telangana'],
  ['ts', 'telangana'],
  ['tripura', 'tripura'],
  ['tr', 'tripura'],
  ['uttar pradesh', 'uttar pradesh'],
  ['up', 'uttar pradesh'],
  ['uttarakhand', 'uttarakhand'],
  ['uk', 'uttarakhand'],
  ['ut', 'uttarakhand'],
  ['west bengal', 'west bengal'],
  ['wb', 'west bengal'],
  ['delhi', 'delhi'],
  ['dl', 'delhi'],
  ['new delhi', 'delhi']
]);

export function normalizeStateName(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bstate\b/g, '')
    .replace(/\but\b/g, '')
    .replace(/\s+/g, ' ');
  return STATE_ALIAS_MAP.get(raw) || raw;
}

export function isSameIndianState(a, b) {
  const left = normalizeStateName(a);
  const right = normalizeStateName(b);
  return Boolean(left && right && left === right);
}

export function extractUserState(user) {
  if (!user || typeof user !== 'object') return '';
  const address = user.address && typeof user.address === 'object' ? user.address : {};
  const profile = user.profile && typeof user.profile === 'object' ? user.profile : {};
  const profileAddress = profile.address && typeof profile.address === 'object' ? profile.address : {};
  const branches = Array.isArray(profile.branches) ? profile.branches : [];
  const firstBranch = branches.find((branch) => branch && typeof branch === 'object') || {};
  return (
    address.state ||
    address.region ||
    profile.state ||
    profileAddress.state ||
    firstBranch.state ||
    ''
  );
}

export function assertGstStateInputs({ supplierState, billingState, context = 'GST calculation' } = {}) {
  const supplier = normalizeStateName(supplierState);
  const billing = normalizeStateName(billingState);
  if (supplier && billing) return;

  const missing = [];
  if (!supplier) missing.push('supplier state');
  if (!billing) missing.push('billing state');
  const error = new Error(`${context} failed: missing ${missing.join(' and ')} in address.`);
  error.statusCode = 400;
  error.code = 'GST_ADDRESS_STATE_MISSING';
  throw error;
}

export function resolveSupplierProductTaxRates(supplierProduct = {}) {
  const row = supplierProduct && typeof supplierProduct === 'object' ? supplierProduct : {};
  const attrs = parseSupplierOfferAttributes(row.attributes);
  const pickRate = (...values) => {
    for (const value of values) {
      if (value !== null && value !== undefined && value !== '') {
        return asNumber(value);
      }
    }
    return null;
  };
  return {
    igstRate: pickRate(row.igst_rate, attrs?.igstRate, attrs?.igst_rate),
    cgstRate: pickRate(row.cgst_rate, attrs?.cgstRate, attrs?.cgst_rate),
    sgstRate: pickRate(row.sgst_rate, attrs?.sgstRate, attrs?.sgst_rate)
  };
}

export function assertSupplierProductTaxRates({ supplierProduct, context = 'GST calculation', productRef = '' } = {}) {
  const rates = resolveSupplierProductTaxRates(supplierProduct);
  if (rates.igstRate != null && rates.cgstRate != null && rates.sgstRate != null) return;

  const missing = [];
  if (rates.igstRate == null) missing.push('IGST rate');
  if (rates.cgstRate == null) missing.push('CGST rate');
  if (rates.sgstRate == null) missing.push('SGST rate');
  const suffix = productRef ? ` for ${productRef}` : '';
  const error = new Error(`${context} failed: missing ${missing.join(', ')}${suffix} in supplier product tax config.`);
  error.statusCode = 400;
  error.code = 'GST_TAX_RATES_MISSING';
  throw error;
}

export function extractStateFromIndianAddress(address = {}) {
  const raw = address?.state || address?.region || '';
  return normalizeStateName(raw) || String(raw || '').trim();
}

export function extractStateFromLocationText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (/^\d{6}$/.test(part)) continue;
    if (part.toLowerCase() === 'india') continue;
    const normalized = normalizeStateName(part);
    if (normalized) return normalized;
  }
  return '';
}

/** Supplier registration / dispatch state used to decide IGST vs CGST+SGST. */
export function resolveSupplierStateForGst({
  supplierUser = null,
  supplierProduct = null,
  outlet = null,
  pickupAddress = null
} = {}) {
  const fromUser = extractUserState(supplierUser);
  if (fromUser) return normalizeStateName(fromUser) || String(fromUser).trim();

  const outletAddress =
    outlet?.address && typeof outlet.address === 'object' ? outlet.address : outlet || null;
  const fromOutlet = extractStateFromIndianAddress(outletAddress || {});
  if (fromOutlet) return fromOutlet;

  const fromPickup = extractStateFromIndianAddress(pickupAddress || {});
  if (fromPickup) return fromPickup;

  const fromOfferLocation = extractStateFromLocationText(supplierProduct?.location || '');
  if (fromOfferLocation) return fromOfferLocation;

  return '';
}

export function deriveGstTaxTypeFromTotals({ igstAmount = 0, cgstAmount = 0, sgstAmount = 0 } = {}) {
  const igst = asNumber(igstAmount);
  const cgst = asNumber(cgstAmount);
  const sgst = asNumber(sgstAmount);
  if (igst > 0 && cgst <= 0 && sgst <= 0) return 'IGST';
  if ((cgst > 0 || sgst > 0) && igst <= 0) return 'CGST_SGST';
  if (igst > 0 && (cgst > 0 || sgst > 0)) return 'MIXED';
  return 'NONE';
}

/** Place of supply state drives IGST vs CGST+SGST (billing when GSTIN registered). */
export function resolveGstPlaceOfSupplyState({
  hasGstin = false,
  deliveryDestination = 'shipping',
  billingAddress = {},
  shippingAddress = {}
} = {}) {
  const billingState = billingAddress?.state || billingAddress?.region || '';
  const shippingState = shippingAddress?.state || shippingAddress?.region || '';
  if (hasGstin) {
    if (deliveryDestination === 'billing' && billingState) return billingState;
    if (billingState) return billingState;
  }
  return shippingState || billingState || '';
}

export function buildOrderGstSummary({
  lineTaxBreakdown = [],
  supplierState = '',
  billingState = '',
  placeOfSupplyState = '',
  intraStateTax = false
} = {}) {
  const totals = sumGstLines(lineTaxBreakdown);
  const posState = placeOfSupplyState || billingState || '';
  return {
    ...totals,
    taxType: deriveGstTaxTypeFromTotals(totals),
    supplierState: normalizeStateName(supplierState) || String(supplierState || '').trim(),
    billingState: normalizeStateName(billingState) || String(billingState || '').trim(),
    placeOfSupplyState: normalizeStateName(posState) || String(posState || '').trim(),
    intraStateTax: Boolean(intraStateTax)
  };
}

export function parseOrderItemSpecifications(specifications) {
  if (!specifications) return {};
  if (typeof specifications === 'object' && !Array.isArray(specifications)) return specifications;
  if (typeof specifications === 'string') {
    try {
      const parsed = JSON.parse(specifications);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Immutable GST snapshot captured on each order line at placement. */
export function lineGstFromOrderItemSnapshot(item, fallbackTaxableAmount = 0) {
  const specs = parseOrderItemSpecifications(item?.specifications);
  const gst = specs?.gst;
  if (!gst || typeof gst !== 'object' || !gst.taxType) return null;

  const taxableAmount = asNumber(gst.taxableAmount ?? fallbackTaxableAmount);
  const taxAmount = asNumber(gst.taxAmount);
  const igstAmount = asNumber(gst.igstAmount);
  const cgstAmount = asNumber(gst.cgstAmount);
  const sgstAmount = asNumber(gst.sgstAmount);

  return {
    taxableAmount,
    taxType: gst.taxType,
    igstRate: asNumber(gst.igstRate),
    cgstRate: asNumber(gst.cgstRate),
    sgstRate: asNumber(gst.sgstRate),
    igstAmount: igstAmount || (gst.taxType === 'IGST' ? taxAmount : 0),
    cgstAmount: cgstAmount || (gst.taxType === 'CGST_SGST' ? taxAmount / 2 : 0),
    sgstAmount: sgstAmount || (gst.taxType === 'CGST_SGST' ? taxAmount / 2 : 0),
    taxAmount: taxAmount || igstAmount + cgstAmount + sgstAmount,
    totalAmount: asNumber(gst.totalAmount ?? taxableAmount + taxAmount),
    supplierState: gst.supplierState || '',
    billingState: gst.billingState || gst.placeOfSupplyState || '',
    placeOfSupplyState: gst.placeOfSupplyState || gst.billingState || '',
    intraStateTax: Boolean(gst.intraStateTax)
  };
}

export function formatGstTaxTypeLabel(taxType) {
  if (taxType === 'IGST') return 'IGST (inter-state)';
  if (taxType === 'CGST_SGST') return 'CGST + SGST (same state)';
  if (taxType === 'MIXED') return 'IGST + CGST/SGST (mixed lines)';
  return 'No GST';
}

export function computeLineGst({
  taxableAmount = 0,
  igstRate = 0,
  cgstRate = 0,
  sgstRate = 0,
  intraState = false,
  supplierProduct = null
} = {}) {
  const resolvedRates = supplierProduct ? resolveSupplierProductTaxRates(supplierProduct) : null;
  const taxable = roundMoney(taxableAmount);
  const safeIgst = asNumber(resolvedRates?.igstRate ?? igstRate);
  const safeCgst = asNumber(resolvedRates?.cgstRate ?? cgstRate);
  const safeSgst = asNumber(resolvedRates?.sgstRate ?? sgstRate);

  if (intraState) {
    const cgstAmount = roundMoney((taxable * safeCgst) / 100);
    const sgstAmount = roundMoney((taxable * safeSgst) / 100);
    const taxAmount = roundMoney(cgstAmount + sgstAmount);
    return {
      taxableAmount: taxable,
      taxType: 'CGST_SGST',
      igstRate: 0,
      cgstRate: safeCgst,
      sgstRate: safeSgst,
      igstAmount: 0,
      cgstAmount,
      sgstAmount,
      taxAmount,
      totalAmount: roundMoney(taxable + taxAmount)
    };
  }

  const igstAmount = roundMoney((taxable * safeIgst) / 100);
  return {
    taxableAmount: taxable,
    taxType: 'IGST',
    igstRate: safeIgst,
    cgstRate: 0,
    sgstRate: 0,
    igstAmount,
    cgstAmount: 0,
    sgstAmount: 0,
    taxAmount: igstAmount,
    totalAmount: roundMoney(taxable + igstAmount)
  };
}

export function sumGstLines(lines = []) {
  const totals = (lines || []).reduce(
    (acc, line) => {
      acc.subtotalAmount += asNumber(line?.taxableAmount);
      acc.taxAmount += asNumber(line?.taxAmount);
      acc.igstAmount += asNumber(line?.igstAmount);
      acc.cgstAmount += asNumber(line?.cgstAmount);
      acc.sgstAmount += asNumber(line?.sgstAmount);
      acc.totalAmount += asNumber(line?.totalAmount);
      return acc;
    },
    {
      subtotalAmount: 0,
      taxAmount: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      totalAmount: 0
    }
  );
  return {
    subtotalAmount: roundMoney(totals.subtotalAmount),
    taxAmount: roundMoney(totals.taxAmount),
    igstAmount: roundMoney(totals.igstAmount),
    cgstAmount: roundMoney(totals.cgstAmount),
    sgstAmount: roundMoney(totals.sgstAmount),
    totalAmount: roundMoney(totals.totalAmount),
    taxType: deriveGstTaxTypeFromTotals(totals)
  };
}

export function buildPoGroupsCheckoutSummary(poGroups = []) {
  const groups = Array.isArray(poGroups) ? poGroups : [];
  const productSubtotal = roundMoney(
    groups.reduce((sum, group) => sum + asNumber(group?.subtotal ?? group?.total ?? group?.gstSummary?.subtotalAmount), 0)
  );
  const gstAmount = roundMoney(
    groups.reduce((sum, group) => sum + asNumber(group?.gstAmount ?? group?.gstSummary?.taxAmount), 0)
  );
  const productsInclGst = roundMoney(
    groups.reduce((sum, group) => {
      const incl = asNumber(group?.totalInclGst ?? group?.gstSummary?.totalAmount);
      if (incl > 0) return sum + incl;
      return sum + asNumber(group?.subtotal ?? group?.total) + asNumber(group?.gstAmount);
    }, 0)
  );
  return {
    productSubtotal,
    gstAmount,
    productsInclGst: productsInclGst || roundMoney(productSubtotal + gstAmount)
  };
}
