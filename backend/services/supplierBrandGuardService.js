import { normalizeBrandKey } from './supplyChainSharedService.js';

export function parseBrandTokens(str) {
  if (!str || !String(str).trim()) return [];
  return String(str)
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeChainNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeBrandKeyFromAttributes(value) {
  const tokens = parseBrandTokens(value);
  if (tokens.length > 0) return normalizeBrandKey(tokens[0]);
  return normalizeBrandKey(value);
}

/** Brand label for upstream routing — offer attributes plus catalog brand. */
export function resolveUpstreamBrandLabel(attributes, productBrand) {
  const fromAttrs =
    attributes?.brandModel != null && String(attributes.brandModel).trim() !== ''
      ? String(attributes.brandModel).trim()
      : attributes?.brand != null && String(attributes.brand).trim() !== ''
        ? String(attributes.brand).trim()
        : '';
  const fromProduct = productBrand != null && String(productBrand).trim() !== '' ? String(productBrand).trim() : '';
  return fromAttrs || fromProduct || '';
}

function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

function brandNameEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

export function brandTokenKeysMatch(a, b) {
  const keyA = normalizeBrandKey(String(a).replace(/-/g, ' '));
  const keyB = normalizeBrandKey(String(b).replace(/-/g, ' '));
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (collapseRepeatedLetters(keyA) === collapseRepeatedLetters(keyB)) return true;

  const wordsA = keyA.split(' ').filter(Boolean);
  const wordsB = keyB.split(' ').filter(Boolean);
  const tokenA = wordsA[0] || '';
  const tokenB = wordsB[0] || '';

  // Same leading token (Philips / Phillips Lighting) — require a complete token, never a prefix.
  if (
    tokenA.length >= 3 &&
    tokenB.length >= 3 &&
    collapseRepeatedLetters(tokenA) === collapseRepeatedLetters(tokenB)
  ) {
    return true;
  }

  // Near-typo of a complete brand token (Faststark ≈ Fastrack).
  const maxLen = Math.max(tokenA.length, tokenB.length);
  const minLen = Math.min(tokenA.length, tokenB.length);
  const lengthDelta = Math.abs(tokenA.length - tokenB.length);
  if (maxLen >= 5 && lengthDelta <= 2) {
    const distance = brandNameEditDistance(tokenA, tokenB);
    if (distance === 1 && lengthDelta <= 1) {
      const shorterLen = Math.min(tokenA.length, tokenB.length);
      const longerLen = Math.max(tokenA.length, tokenB.length);
      // Avoid short extensions of short brands (pran → prans).
      if (!(longerLen > shorterLen && shorterLen < 6)) return true;
    } else {
      let sharedPrefix = 0;
      while (sharedPrefix < minLen && tokenA[sharedPrefix] === tokenB[sharedPrefix]) {
        sharedPrefix += 1;
      }
      if (minLen >= 8 && sharedPrefix >= 4 && distance <= 3) return true;
    }
  }

  // Multi-word containment: "havells" matches "havells electrical", but "h" must not match "hp".
  const isWordPrefix = (shorter, longer) =>
    shorter.length >= 1 &&
    longer.length > shorter.length &&
    shorter.every((word, index) => word === longer[index]) &&
    String(shorter[shorter.length - 1] || '').length >= 3;

  if (isWordPrefix(wordsA, wordsB) || isWordPrefix(wordsB, wordsA)) return true;
  return false;
}

export function getViewerBrandTokensForRole(profile, myRole) {
  const tokens = new Set();
  if (!myRole) return tokens;
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  let roleEntryFound = false;
  for (const e of entries) {
    if (e?.role === myRole) {
      roleEntryFound = true;
      parseBrandTokens(e.brands).forEach((t) => tokens.add(t));
    }
  }
  if (entries.length === 0 && profile?.supplierRole === myRole) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  } else if (roleEntryFound && tokens.size === 0) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  } else if (!roleEntryFound && profile?.supplierRole === myRole) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  }
  return tokens;
}

export function entryOverlapsViewerBrands(entry, viewerBrandTokens) {
  if (!viewerBrandTokens || viewerBrandTokens.size === 0) return true;
  const entryTokens = parseBrandTokens(entry?.brands);
  if (entryTokens.length === 0) return true;
  for (const entryToken of entryTokens) {
    for (const viewerToken of viewerBrandTokens) {
      if (entryToken === viewerToken || brandTokenKeysMatch(entryToken, viewerToken)) return true;
    }
  }
  return false;
}

/** Whether a supply-chain role entry declares overlap with a product/catalog brand label. */
export function roleDeclaresBrand(profile, role, brandInput) {
  if (!profile || !role) return false;
  const roleTokens = getViewerBrandTokensForRole(profile, role);
  if (roleTokens.size === 0) return false;
  const productTokens = new Set(parseBrandTokens(brandInput));
  const normalized = normalizeBrandKey(brandInput);
  if (normalized) productTokens.add(normalized);
  if (productTokens.size === 0) return false;
  return entryOverlapsViewerBrands({ brands: [...roleTokens].join(', ') }, productTokens);
}

export function getAllDeclaredBrandTokens(profile) {
  const tokens = new Set();
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  for (const e of entries) {
    parseBrandTokens(e?.brands).forEach((t) => tokens.add(t));
  }
  parseBrandTokens(profile?.brands).forEach((t) => tokens.add(t));
  return tokens;
}

/** Declared brand labels from Select yourself, preserving the supplier's saved spelling. */
export function getDeclaredBrandLabels(profile) {
  const labels = [];
  const seen = new Set();
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];

  const addLabel = (raw) => {
    const label = String(raw || '').trim();
    if (!label) return;
    const key = normalizeBrandKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  for (const entry of entries) {
    if (Array.isArray(entry?.brands)) {
      entry.brands.forEach(addLabel);
    } else {
      addLabel(entry?.brands);
    }
  }
  if (Array.isArray(profile?.brands)) {
    profile.brands.forEach(addLabel);
  } else {
    addLabel(profile?.brands);
  }
  return labels;
}

function findMatchingDeclaredBrandLabel(profile, brandInput) {
  const declaredLabels = getDeclaredBrandLabels(profile);
  const candidate = String(brandInput || '').trim();
  if (!candidate) return null;
  const candidateLower = candidate.toLowerCase();

  for (const label of declaredLabels) {
    if (label.toLowerCase() === candidateLower) return label;
  }
  for (const label of declaredLabels) {
    if (brandTokenKeysMatch(label, candidate)) return label;
  }
  return null;
}

export function brandIsAllowedForSupplier(profile, brandInput) {
  const declared = getAllDeclaredBrandTokens(profile);
  if (declared.size === 0) return { allowed: true, reason: 'no_brand_lock' };
  const matchedLabel = findMatchingDeclaredBrandLabel(profile, brandInput);
  if (matchedLabel) {
    return { allowed: true, reason: 'exact', matchedBrand: matchedLabel };
  }
  const b = String(brandInput || '').trim().toLowerCase();
  if (!b) return { allowed: false, reason: 'brand_required' };
  return { allowed: false, reason: 'not_in_profile', declared: [...declared] };
}

/**
 * Product create/update may receive both the supplier-selected brand and a catalog canonical brand.
 * Allow when either matches the supplier's declared Select yourself brands.
 */
export function resolveSupplierProductBrandGuard(profile, { selectedBrand = '', catalogBrand = '' } = {}) {
  const candidates = [...new Set(
    [selectedBrand, catalogBrand]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];

  if (candidates.length === 0) {
    const guard = brandIsAllowedForSupplier(profile, '');
    return { allowed: guard.allowed, brand: '', guard };
  }

  for (const candidate of candidates) {
    const guard = brandIsAllowedForSupplier(profile, candidate);
    if (guard.allowed) {
      return {
        allowed: true,
        brand: guard.matchedBrand || findMatchingDeclaredBrandLabel(profile, candidate) || candidate,
        guard
      };
    }
  }

  const guard = brandIsAllowedForSupplier(profile, candidates[0]);
  return { allowed: false, brand: '', guard };
}

/**
 * Strict visibility gate for supplier-facing product surfaces.
 * If profile has no declared brands, access is denied (show nothing) until profile brands are configured/approved.
 */
export function supplierCanAccessBrandStrict(profile, brandInput) {
  const declared = getAllDeclaredBrandTokens(profile);
  if (declared.size === 0) {
    return { allowed: false, reason: 'no_declared_brands' };
  }
  const result = brandIsAllowedForSupplier(profile, brandInput);
  if (!result.allowed) return result;
  if (result.reason === 'no_brand_lock') {
    return { allowed: false, reason: 'no_declared_brands' };
  }
  return result;
}
