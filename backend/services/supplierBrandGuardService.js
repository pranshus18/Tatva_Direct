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
  if (tokens.length > 0) return normalizeChainNameKey(tokens[0]);
  return normalizeChainNameKey(value);
}

export function getViewerBrandTokensForRole(profile, myRole) {
  const tokens = new Set();
  if (!myRole) return tokens;
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  for (const e of entries) {
    if (e?.role === myRole) {
      parseBrandTokens(e.brands).forEach((t) => tokens.add(t));
    }
  }
  // Legacy fallback should apply only when role-wise entries are absent.
  if (entries.length === 0 && profile?.supplierRole === myRole) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  }
  return tokens;
}

export function entryOverlapsViewerBrands(entry, viewerBrandTokens) {
  if (!viewerBrandTokens || viewerBrandTokens.size === 0) return true;
  const entryTokens = parseBrandTokens(entry?.brands);
  return entryTokens.some((t) => viewerBrandTokens.has(t));
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

export function brandIsAllowedForSupplier(profile, brandInput) {
  const declared = getAllDeclaredBrandTokens(profile);
  if (declared.size === 0) return { allowed: true, reason: 'no_brand_lock' };
  const b = String(brandInput || '').trim().toLowerCase();
  if (!b) return { allowed: false, reason: 'brand_required' };
  for (const t of declared) {
    if (t === b) return { allowed: true, reason: 'exact' };
    if (t.length >= 2 && (b.includes(t) || t.includes(b))) return { allowed: true, reason: 'contains' };
  }
  return { allowed: false, reason: 'not_in_profile', declared: [...declared] };
}
