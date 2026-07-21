import { normalizeChainRolesFromStages as normalizeChainRolesFromStagesCanonical } from '../services/supplyChainSharedService.js';

const FULL_BRAND_MAP_TTL_MS = 5 * 60 * 1000;
let cachedFullBrandMap = null;
let cachedFullBrandMapAt = 0;

export function normalizeBrandChainKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeChainRolesFromStages(stages) {
  return normalizeChainRolesFromStagesCanonical(stages);
}

export function getTerminalRoleFromStages(stages) {
  const roles = normalizeChainRolesFromStages(stages);
  return roles.length > 0 ? roles[roles.length - 1] : null;
}

async function loadFullAdminBrandTerminalRoleMap(supabase) {
  const now = Date.now();
  if (cachedFullBrandMap && now - cachedFullBrandMapAt < FULL_BRAND_MAP_TTL_MS) {
    return cachedFullBrandMap;
  }

  const { data, error } = await supabase
    .from('category_supply_chains')
    .select('category_name, stages');
  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    const key = normalizeBrandChainKey(row?.category_name);
    if (!key) continue;
    const terminalRole = getTerminalRoleFromStages(row?.stages);
    if (terminalRole) map.set(key, terminalRole);
  }

  cachedFullBrandMap = map;
  cachedFullBrandMapAt = now;
  return map;
}

export async function loadAdminBrandTerminalRoleMap(supabase, brandNames) {
  const requestedKeys = new Set(
    (brandNames || []).map((n) => normalizeBrandChainKey(n)).filter(Boolean)
  );

  const fullMap = await loadFullAdminBrandTerminalRoleMap(supabase);
  if (requestedKeys.size === 0) return fullMap;

  const filtered = new Map();
  for (const key of requestedKeys) {
    const role = fullMap.get(key);
    if (role) filtered.set(key, role);
  }
  return filtered;
}

/** Test helper / manual cache bust after admin supply-chain edits. */
export function clearAdminBrandTerminalRoleMapCache() {
  cachedFullBrandMap = null;
  cachedFullBrandMapAt = 0;
}

export function getAllowedSellerRoleForBrand(brandName, terminalRoleByBrandMap) {
  const brandKey = normalizeBrandChainKey(brandName);
  if (!brandKey) return null;
  return terminalRoleByBrandMap.get(brandKey) || null;
}

function parseBrandTokens(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(/[,;\n/|]+/)
    .map((token) => normalizeBrandChainKey(token))
    .filter(Boolean);
}

function profileHasRoleForBrand(profile, role, brandName) {
  if (!profile || !role) return false;
  const brandKey = normalizeBrandChainKey(brandName);
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];

  const matchingEntries = entries.filter((entry) => entry && entry.role === role);
  if (matchingEntries.length > 0) {
    if (!brandKey) return true;
    return matchingEntries.some((entry) => {
      const brands = new Set(parseBrandTokens(entry?.brands));
      return brands.has(brandKey);
    });
  }

  if (profile.supplierRole !== role) return false;
  if (!brandKey) return true;
  const legacyBrands = new Set(parseBrandTokens(profile?.brands));
  return legacyBrands.has(brandKey);
}

export function supplierMatchesBrandTerminalRole(supplierProfile, brandName, terminalRoleByBrandMap) {
  const requiredRole = getAllowedSellerRoleForBrand(brandName, terminalRoleByBrandMap);
  // If no admin chain exists for the brand, keep behavior permissive.
  if (!requiredRole) return true;
  return profileHasRoleForBrand(supplierProfile, requiredRole, brandName);
}
