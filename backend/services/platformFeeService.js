import { supabase } from '../config/supabase.js';
import { parseBrandTokens } from './supplierBrandGuardService.js';
import {
  brandKeysMatchForChainLookup,
  normalizeBrandKey,
  SUPPLY_CHAIN_ROLES_IN_ORDER
} from './supplyChainSharedService.js';

const ROLE_SET = new Set(SUPPLY_CHAIN_ROLES_IN_ORDER);
const DEFAULT_FEE_PERCENT = Number.parseFloat(process.env.PLATFORM_FEE_PERCENT_DEFAULT || '5') || 5;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(toFiniteNumber(value).toFixed(2));
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLE_SET.has(role) ? role : null;
}

function parseCompanyInfoEntries(profile) {
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  return entries.filter((row) => row && typeof row === 'object');
}

function roleMatchesBrand(entry, wantedBrandKey) {
  if (!wantedBrandKey) return true;
  const tokensRaw = Array.isArray(entry?.brands) ? entry.brands.join(',') : entry?.brands;
  const tokens = parseBrandTokens(tokensRaw).map((token) => normalizeBrandKey(token)).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => brandKeysMatchForChainLookup(wantedBrandKey, token));
}

export function resolveSupplierRoleFromProfile(profile, brandName) {
  const wantedBrandKey = normalizeBrandKey(brandName);
  const entries = parseCompanyInfoEntries(profile);

  for (const entry of entries) {
    const role = normalizeRole(entry?.role);
    if (!role) continue;
    if (roleMatchesBrand(entry, wantedBrandKey)) return role;
  }

  return normalizeRole(profile?.supplierRole);
}

export async function getSupplierRoleForBrand(supplierId, brandName) {
  if (!supplierId) return null;
  const { data: user, error } = await supabase
    .from('users')
    .select('id, profile')
    .eq('id', supplierId)
    .maybeSingle();
  if (error) throw error;
  if (!user) return null;
  return resolveSupplierRoleFromProfile(user.profile || {}, brandName);
}

function isRuleEffectiveNow(rule, nowTs) {
  const now = nowTs ? new Date(nowTs).getTime() : Date.now();
  const from = rule?.effective_from ? new Date(rule.effective_from).getTime() : null;
  const to = rule?.effective_to ? new Date(rule.effective_to).getTime() : null;
  if (from && Number.isFinite(from) && now < from) return false;
  if (to && Number.isFinite(to) && now >= to) return false;
  return true;
}

function pickRuleBySpecificity(rows, normalizedBrand) {
  const list = (rows || []).filter((row) => row && row.is_active !== false);
  const nowRows = list.filter((row) => isRuleEffectiveNow(row));
  const exact =
    normalizedBrand &&
    nowRows.find((row) => normalizeBrandKey(row.normalized_brand || row.brand_name) === normalizedBrand);
  if (exact) return exact;
  const global = nowRows.find((row) => !String(row.normalized_brand || '').trim());
  return global || null;
}

export async function resolveFeeRule({ brandName, supplyChainRole }) {
  const role = normalizeRole(supplyChainRole);
  if (!role) return null;
  const normalizedBrand = normalizeBrandKey(brandName);

  const { data: rows, error } = await supabase
    .from('supply_chain_platform_fees')
    .select('*')
    .eq('supply_chain_role', role)
    .eq('is_active', true)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return pickRuleBySpecificity(rows, normalizedBrand);
}

export function calculateLinePlatformFee({ lineAmount, feeRule }) {
  const amount = toFiniteNumber(lineAmount);
  if (amount <= 0) return 0;

  const feeType = String(feeRule?.fee_type || 'percentage').toLowerCase();
  const feeValue = toFiniteNumber(feeRule?.fee_value, DEFAULT_FEE_PERCENT);
  if (feeType === 'fixed') return roundMoney(feeValue);
  return roundMoney((amount * feeValue) / 100);
}

export async function calculateOrderPlatformFee({
  order,
  orderItems = [],
  supplierId
}) {
  const fallbackAmount = toFiniteNumber(order?.total_amount);
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    const fallbackFee = roundMoney((fallbackAmount * DEFAULT_FEE_PERCENT) / 100);
    return {
      feeAmount: fallbackFee,
      breakdown: [
        {
          orderItemId: null,
          amount: fallbackAmount,
          brand: null,
          supplyChainRole: null,
          feeType: 'percentage',
          feeValue: DEFAULT_FEE_PERCENT,
          feeAmount: fallbackFee,
          source: 'env_fallback'
        }
      ]
    };
  }

  let totalFee = 0;
  const breakdown = [];

  for (const item of orderItems) {
    const lineAmount = toFiniteNumber(item.total_price) || toFiniteNumber(item.unit_price) * toFiniteNumber(item.quantity, 1);
    const brandName = item?.product?.brand || item?.brand || null;
    const role = await getSupplierRoleForBrand(supplierId || order?.supplier_id, brandName);
    const feeRule = await resolveFeeRule({ brandName, supplyChainRole: role });
    const feeType = feeRule?.fee_type || 'percentage';
    const feeValue = toFiniteNumber(feeRule?.fee_value, DEFAULT_FEE_PERCENT);
    const lineFee = calculateLinePlatformFee({
      lineAmount,
      feeRule: feeRule || { fee_type: 'percentage', fee_value: DEFAULT_FEE_PERCENT }
    });
    totalFee += lineFee;
    breakdown.push({
      orderItemId: item.id || null,
      amount: roundMoney(lineAmount),
      brand: brandName || null,
      supplyChainRole: role,
      feeType,
      feeValue,
      feeAmount: lineFee,
      ruleId: feeRule?.id || null,
      source: feeRule ? 'rule' : 'env_fallback'
    });
  }

  return {
    feeAmount: roundMoney(totalFee),
    breakdown
  };
}

export async function listSupplyChainFeeRules() {
  const { data, error } = await supabase
    .from('supply_chain_platform_fees')
    .select('*')
    .order('supply_chain_role', { ascending: true })
    .order('normalized_brand', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertSupplyChainFeeRules({ rules, actorUserId }) {
  const payload = (rules || []).map((rule) => {
    const normalizedBrand = normalizeBrandKey(rule.brandName || '');
    return {
      ...(rule.id ? { id: rule.id } : {}),
      brand_name: rule.brandName ? String(rule.brandName).trim() : null,
      normalized_brand: normalizedBrand || null,
      supply_chain_role: normalizeRole(rule.supplyChainRole),
      fee_type: String(rule.feeType || 'percentage').toLowerCase() === 'fixed' ? 'fixed' : 'percentage',
      fee_value: roundMoney(toFiniteNumber(rule.feeValue)),
      is_active: rule.isActive !== false,
      effective_from: rule.effectiveFrom || new Date().toISOString(),
      effective_to: rule.effectiveTo || null,
      notes: rule.notes ? String(rule.notes).slice(0, 1000) : null,
      updated_by: actorUserId || null,
      updated_at: new Date().toISOString()
    };
  });

  const { data, error } = await supabase
    .from('supply_chain_platform_fees')
    .upsert(payload, { onConflict: 'id' })
    .select('*');
  if (error) throw error;
  return data || [];
}
