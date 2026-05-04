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
  return (lines || []).reduce(
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
}
