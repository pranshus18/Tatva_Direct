import { supabase } from '../config/supabase.js';
import { parseBrandTokens } from './supplierBrandGuardService.js';
import {
  brandKeysMatchForChainLookup,
  normalizeBrandKey,
  SUPPLY_CHAIN_ROLES_IN_ORDER
} from './supplyChainSharedService.js';

const ROLE_SET = new Set(SUPPLY_CHAIN_ROLES_IN_ORDER);

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
  return exact || null;
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
  if (!feeRule) {
    const err = new Error('Platform fee rule is not configured for this brand and supply-chain role.');
    err.code = 'PLATFORM_FEE_RULE_MISSING';
    throw err;
  }

  const feeType = String(feeRule?.fee_type || 'percentage').toLowerCase();
  const feeValue = toFiniteNumber(feeRule?.fee_value, 0);
  if (feeType === 'fixed') return roundMoney(feeValue);
  return roundMoney((amount * feeValue) / 100);
}

export async function calculateOrderPlatformFee({
  order,
  orderItems = [],
  supplierId
}) {
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    const err = new Error('Platform fee cannot be computed because this order has no line items.');
    err.code = 'PLATFORM_FEE_ORDER_ITEMS_MISSING';
    throw err;
  }

  let totalFee = 0;
  const breakdown = [];

  for (const item of orderItems) {
    const lineAmount = toFiniteNumber(item.total_price) || toFiniteNumber(item.unit_price) * toFiniteNumber(item.quantity, 1);
    const brandName = item?.product?.brand || item?.brand || null;
    if (!String(brandName || '').trim()) {
      const err = new Error('Platform fee cannot be computed: brand is missing for one or more order items.');
      err.code = 'PLATFORM_FEE_BRAND_MISSING';
      throw err;
    }
    const role = await getSupplierRoleForBrand(supplierId || order?.supplier_id, brandName);
    if (!role) {
      const err = new Error(
        `Platform fee cannot be computed: supplier role is not approved for brand "${brandName}".`
      );
      err.code = 'PLATFORM_FEE_ROLE_MISSING';
      throw err;
    }
    const feeRule = await resolveFeeRule({ brandName, supplyChainRole: role });
    if (!feeRule) {
      const err = new Error(
        `Platform fee is not configured by admin for brand "${brandName}" at role "${role}".`
      );
      err.code = 'PLATFORM_FEE_RULE_MISSING';
      throw err;
    }
    const feeType = feeRule?.fee_type || 'percentage';
    const feeValue = toFiniteNumber(feeRule?.fee_value, 0);
    const lineFee = calculateLinePlatformFee({
      lineAmount,
      feeRule
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
      source: 'brand_role_rule'
    });
  }

  return {
    feeAmount: roundMoney(totalFee),
    breakdown
  };
}

async function loadOrderItemsForFee(orderId) {
  const { data: rows, error } = await supabase
    .from('order_items')
    .select(`
      id,
      quantity,
      unit_price,
      total_price,
      product:products (
        id,
        brand
      )
    `)
    .eq('order_id', orderId);
  if (error) throw error;
  return rows || [];
}

/**
 * Compute and persist platform fee economics for a paid order.
 * Enforces strict admin-defined brand+role fee rules for every order line.
 */
export async function applyPlatformFeeToPaidOrder({ orderId, order: orderInput = null }) {
  let order = orderInput || null;
  if (!order) {
    const { data: loadedOrder, error: orderLoadError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (orderLoadError) throw orderLoadError;
    order = loadedOrder;
  }
  if (!order?.id) {
    const err = new Error('Order not found while applying platform fee.');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  const orderItems = await loadOrderItemsForFee(order.id);
  const feeResult = await calculateOrderPlatformFee({
    order,
    orderItems,
    supplierId: order.supplier_id
  });
  const grossAmount = roundMoney(order.total_amount);
  const platformFeeAmount = Math.min(grossAmount, roundMoney(feeResult.feeAmount));
  const supplierPayoutAmount = roundMoney(grossAmount - platformFeeAmount);
  const inferredRole = feeResult.breakdown.find((line) => line.supplyChainRole)?.supplyChainRole || null;

  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      platform_fee_amount: platformFeeAmount,
      supplier_payout_amount: supplierPayoutAmount,
      supply_chain_role_at_payment: inferredRole,
      platform_fee_breakdown: feeResult.breakdown
    })
    .eq('id', order.id)
    .select('*')
    .single();
  if (orderUpdateError) throw orderUpdateError;

  const { error: payoutError } = await supabase.from('supplier_payouts').upsert(
    {
      order_id: order.id,
      supplier_id: order.supplier_id,
      gross_amount: grossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: supplierPayoutAmount,
      status: 'pending',
      metadata: {
        feeBreakdown: feeResult.breakdown
      },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'order_id' }
  );
  if (payoutError) throw payoutError;

  return {
    order: updatedOrder,
    platformFeeAmount,
    supplierPayoutAmount,
    feeBreakdown: feeResult.breakdown
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
