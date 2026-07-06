import { firstNonEmpty, normalizeBrandKey } from './procurementSharedService.js';

export const detectItemBrand = (item = {}, referenceProduct = null) => {
  const itemSpecs = item?.specifications || {};
  const refSpecs = referenceProduct?.specifications || {};
  const raw = firstNonEmpty(
    item?.brand,
    item?.brandName,
    item?.modelBrand,
    item?.brandModel,
    itemSpecs.brand,
    itemSpecs.modelBrand,
    itemSpecs.brandModel,
    referenceProduct?.brand,
    refSpecs.brand,
    refSpecs.modelBrand,
    refSpecs.brandModel
  );
  return normalizeBrandKey(raw);
};

export const buildNameSearchPatterns = (text) => {
  const base = String(text || '').trim().toLowerCase();
  if (!base) return [];
  const tokens = base
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  return [...new Set([`%${base}%`, ...tokens.map((t) => `%${t}%`)])];
};

export const normalizeSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const textTokens = (value) => normalizeSearchText(value).split(/\s+/).filter((t) => t.length > 1);

export const fuzzyNameCompatible = (requestedName, candidateName) => {
  const req = textTokens(requestedName);
  const cand = textTokens(candidateName);
  if (req.length === 0 || cand.length === 0) return false;
  const candSet = new Set(cand);
  const overlap = req.filter((t) => candSet.has(t)).length;
  const overlapRatio = overlap / req.length;
  return overlapRatio >= 0.5;
};

const modelLikeTokens = (value) => textTokens(value).filter((t) => /[a-z]*\d+[a-z]*/i.test(t));

export const hasModelTokenConflict = (requestedName, candidateName) => {
  const req = modelLikeTokens(requestedName);
  const cand = modelLikeTokens(candidateName);
  if (req.length === 0 || cand.length === 0) return false;
  const reqSet = new Set(req.map((t) => t.toLowerCase()));
  const candSet = new Set(cand.map((t) => t.toLowerCase()));
  for (const t of reqSet) {
    if (candSet.has(t)) return false;
  }
  return true;
};

export const detectProductBrandKey = (product = {}) =>
  normalizeBrandKey(
    product?.brand ||
      product?.attributes?.brand ||
      product?.attributes?.brandModel ||
      product?.specifications?.brand ||
      product?.specifications?.brandModel
  );

export const compactLocationText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');

export const isPlaceholderLocationText = (value) => {
  const t = compactLocationText(value).toLowerCase();
  return !t || t === 'location not specified' || t === 'not specified' || t === 'n/a' || t === 'na' || t === '-';
};
const isPlaceholderLocation = isPlaceholderLocationText;

export const uniqueLocationList = (values = []) => [...new Set(values.map(compactLocationText).filter(Boolean))];

export const supplierLocationCandidates = ({ productLocation, supplierAddress, supplierProfile }) => {
  const candidates = [];
  const push = (value) => {
    const t = compactLocationText(value);
    if (t && !isPlaceholderLocation(t)) candidates.push(t);
  };
  const extractPostal = (obj = {}) =>
    firstNonEmpty(obj.pincode, obj.zipCode, obj.postal_code, obj.zip, obj.zip_code);

  push(productLocation);
  if (supplierAddress) {
    const postal = extractPostal(supplierAddress);
    push(postal ? `${postal}, India` : '');
    push([supplierAddress.city, supplierAddress.state, postal].filter(Boolean).join(', '));
    push(
      [supplierAddress.line1, supplierAddress.line2, supplierAddress.area, supplierAddress.city, supplierAddress.state, postal]
        .filter(Boolean)
        .join(', ')
    );
  }

  const branches = Array.isArray(supplierProfile?.branches) ? supplierProfile.branches : [];
  for (const branch of branches) {
    if (!branch) continue;
    const branchPostal = extractPostal(branch);
    push(branchPostal ? `${branchPostal}, India` : '');
    push(branch.location || branch.address);
    push([branch.city, branch.state, branchPostal].filter(Boolean).join(', '));
    push([branch.name, branch.area, branch.city, branch.state, branchPostal].filter(Boolean).join(', '));
  }

  return uniqueLocationList(candidates);
};

export const extractPostalCode = (obj = {}) =>
  firstNonEmpty(obj?.pincode, obj?.zipCode, obj?.postal_code, obj?.zip, obj?.zip_code);

/**
 * Best-effort supplier pincode for voice / display.
 * Prioritized the same way as `supplierLocationCandidates`: the specific product/listing
 * location first (what's actually shown on the card), then the supplier's registered
 * account address, then branch addresses. Using the account address first was causing
 * the wrong pincode to show for suppliers whose listing location differs from their
 * account signup address (e.g. a supplier registered in one city but shipping a
 * specific product from another).
 */
export const resolveSupplierPincode = ({ productLocation, supplierAddress, supplierProfile } = {}) => {
  const locMatch = String(productLocation || '').match(/\b(\d{6})\b/);
  if (locMatch) return locMatch[1];

  const fromAddress = extractPostalCode(supplierAddress);
  if (fromAddress) return String(fromAddress).replace(/\D/g, '').slice(0, 6);

  const branches = Array.isArray(supplierProfile?.branches) ? supplierProfile.branches : [];
  for (const branch of branches) {
    const fromBranch = extractPostalCode(branch);
    if (fromBranch) return String(fromBranch).replace(/\D/g, '').slice(0, 6);
    const branchMatch = String(branch?.location || branch?.address || '').match(/\b(\d{6})\b/);
    if (branchMatch) return branchMatch[1];
  }

  return '';
};
