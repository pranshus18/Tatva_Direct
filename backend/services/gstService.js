const asNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

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

export function assertSupplierProductTaxRates({ supplierProduct, context = 'GST calculation', productRef = '' } = {}) {
  const row = supplierProduct && typeof supplierProduct === 'object' ? supplierProduct : {};
  const hasIgst = row.igst_rate !== null && row.igst_rate !== undefined && row.igst_rate !== '';
  const hasCgst = row.cgst_rate !== null && row.cgst_rate !== undefined && row.cgst_rate !== '';
  const hasSgst = row.sgst_rate !== null && row.sgst_rate !== undefined && row.sgst_rate !== '';
  if (hasIgst && hasCgst && hasSgst) return;

  const missing = [];
  if (!hasIgst) missing.push('IGST rate');
  if (!hasCgst) missing.push('CGST rate');
  if (!hasSgst) missing.push('SGST rate');
  const suffix = productRef ? ` for ${productRef}` : '';
  const error = new Error(`${context} failed: missing ${missing.join(', ')}${suffix} in supplier product tax config.`);
  error.statusCode = 400;
  error.code = 'GST_TAX_RATES_MISSING';
  throw error;
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
  intraState = false
} = {}) {
  const taxable = asNumber(taxableAmount);
  const safeIgst = asNumber(igstRate);
  const safeCgst = asNumber(cgstRate);
  const safeSgst = asNumber(sgstRate);

  if (intraState) {
    const cgstAmount = (taxable * safeCgst) / 100;
    const sgstAmount = (taxable * safeSgst) / 100;
    const taxAmount = cgstAmount + sgstAmount;
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
      totalAmount: taxable + taxAmount
    };
  }

  const igstAmount = (taxable * safeIgst) / 100;
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
    totalAmount: taxable + igstAmount
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
    ...totals,
    taxType: deriveGstTaxTypeFromTotals(totals)
  };
}
