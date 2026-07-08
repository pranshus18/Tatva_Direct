export const SUPPLY_CHAIN_ROLES_IN_ORDER = [
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
];

export const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional Distributor',
  local_distributor: 'Local Distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

export const ROLE_DEPTH = {
  manufacturer: 0,
  stockist: 1,
  regional_distributor: 2,
  local_distributor: 3,
  dealer: 4,
  retailer: 5
};

export const normalizeBrandKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

/** Dedup key for catalog lists — treats Philips and Phillips as the same brand. */
export function catalogBrandDedupKey(value) {
  const key = normalizeBrandKey(value);
  if (!key) return '';
  return collapseRepeatedLetters(key);
}

export function brandKeysMatchForChainLookup(wantedKey, categoryKey) {
  if (!wantedKey || !categoryKey) return false;
  if (wantedKey === categoryKey) return true;
  const wantedToken = wantedKey.split(' ')[0];
  const categoryToken = categoryKey.split(' ')[0];
  if (wantedToken.length >= 3 && wantedToken === categoryToken) return true;
  if (wantedKey.length >= 3 && categoryKey.includes(wantedKey)) return true;
  if (categoryKey.length >= 3 && wantedKey.includes(categoryKey)) return true;
  return false;
}

/** Unique roles from saved stages, always in canonical upstream → downstream order. */
export function normalizeChainRolesFromStages(stages) {
  if (!Array.isArray(stages)) return [];
  const seen = new Set();
  for (const raw of stages) {
    const role = typeof raw === 'string' ? raw : raw?.role;
    if (!role || !SUPPLY_CHAIN_ROLES_IN_ORDER.includes(role) || seen.has(role)) continue;
    seen.add(role);
  }
  return SUPPLY_CHAIN_ROLES_IN_ORDER.filter((r) => seen.has(r));
}

/**
 * Normalize admin/supplier chain stage payloads before save:
 * dedupe roles, sort by tier, reject duplicate roles only.
 */
export function prepareSupplyChainStagesForSave(stages) {
  if (!Array.isArray(stages)) {
    return { ok: false, message: 'stages must be an array' };
  }

  const byRole = new Map();
  for (const s of stages) {
    const role = typeof s === 'string' ? s : s?.role;
    if (!role || !SUPPLY_CHAIN_ROLES_IN_ORDER.includes(role)) {
      return {
        ok: false,
        message: `Invalid role: ${role || '(empty)'}. Use one of: ${SUPPLY_CHAIN_ROLES_IN_ORDER.join(', ')}`
      };
    }
    if (!byRole.has(role)) {
      byRole.set(role, {
        role,
        roleLabel: SUPPLY_CHAIN_ROLE_LABELS[role] || role,
        notes: typeof s?.notes === 'string' ? s.notes.slice(0, 2000) : ''
      });
    }
  }

  if (byRole.size === 0) {
    return { ok: false, message: 'Add at least one supply-chain stage before saving.' };
  }

  const cleaned = SUPPLY_CHAIN_ROLES_IN_ORDER.filter((r) => byRole.has(r)).map((r) => byRole.get(r));
  return { ok: true, stages: cleaned };
}

/** Pick the best admin chain row for a brand (fuzzy name + prefer latest update). */
export function findCategorySupplyChainRowForBrandKey(chainRows, wantedKey) {
  if (!wantedKey) return null;
  const wantedNormalized = normalizeBrandKey(wantedKey);
  const wantedDedup = catalogBrandDedupKey(wantedKey);
  let best = null;
  let bestScore = -1;
  for (const row of chainRows || []) {
    const categoryKey = normalizeBrandKey(row?.category_name);
    const categoryDedup = catalogBrandDedupKey(row?.category_name);
    if (!categoryKey) continue;
    const matches =
      categoryKey === wantedNormalized ||
      categoryDedup === wantedDedup ||
      brandKeysMatchForChainLookup(wantedNormalized, categoryKey) ||
      brandKeysMatchForChainLookup(wantedDedup, categoryDedup);
    if (!matches) continue;
    const roleCount = normalizeChainRolesFromStages(row?.stages).length;
    const updatedTs = Date.parse(row?.updated_at || 0) || 0;
    const score = updatedTs * 10 + roleCount;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}
