import { supabase } from '../config/supabase.js';
import { parseBrandTokens } from './supplierBrandGuardService.js';
import {
  brandKeysMatchForChainLookup,
  normalizeBrandKey,
  SUPPLY_CHAIN_ROLES_IN_ORDER
} from './supplyChainSharedService.js';
import { roundMoney } from '../utils/money.js';

const ROLE_SET = new Set(SUPPLY_CHAIN_ROLES_IN_ORDER);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * Brand used to look up the admin fee matrix for a line.
 * Catalog product brand wins, then variant / offer brand, so every SKU under
 * that brand uses the same admin rule.
 */
export function resolveLineBrandName(item = {}) {
  const product = item.product || {};
  const productSpecs = parseJsonObject(product.specifications);
  const lineSpecs = parseJsonObject(item.specifications);
  const supplierProduct =
    item.supplierProduct || item.supplier_product || item._supplierProduct || {};
  const attrs =
    supplierProduct.attributes && typeof supplierProduct.attributes === 'object'
      ? supplierProduct.attributes
      : {};
  const variant =
    item.productVariant ||
    item.product_variant ||
    item._productVariant ||
    supplierProduct.product_variant ||
    {};

  return firstNonEmptyString(
    product.brand,
    variant.brand,
    attrs.brand,
    productSpecs.brand,
    lineSpecs.brand,
    item.brand,
    item.brandName,
    attrs.brandModel,
    productSpecs.brandModel,
    lineSpecs.brandModel,
    item.brandModel
  );
}

export function resolveLineAmount(item = {}) {
  const lineSpecs = parseJsonObject(item.specifications);
  const gstTotal = roundMoney(toFiniteNumber(lineSpecs?.gst?.totalAmount));
  if (gstTotal > 0) return gstTotal;
  const lineTotal = roundMoney(toFiniteNumber(item.total_price));
  if (lineTotal > 0) return lineTotal;
  return roundMoney(toFiniteNumber(item.unit_price) * toFiniteNumber(item.quantity, 1));
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
  const profile = await loadSupplierProfile(supplierId);
  return resolveSupplierRoleFromProfile(profile, brandName);
}

function isRuleEffectiveNow(rule, nowTs) {
  const now = nowTs ? new Date(nowTs).getTime() : Date.now();
  const from = rule?.effective_from ? new Date(rule.effective_from).getTime() : null;
  const to = rule?.effective_to ? new Date(rule.effective_to).getTime() : null;
  if (from && Number.isFinite(from) && now < from) return false;
  if (to && Number.isFinite(to) && now >= to) return false;
  return true;
}

function ruleBrandKey(rule) {
  return normalizeBrandKey(rule?.normalized_brand || rule?.brand_name || '');
}

/**
 * Pick the admin fee row for a product/variant brand.
 * Exact normalized brand wins; otherwise the same prefix match used by
 * supply-chain lookup (Havells / Havells Electrical).
 */
export function pickFeeRuleForBrand(rows, brandName) {
  const normalizedBrand = normalizeBrandKey(brandName);
  if (!normalizedBrand) return null;
  const list = (rows || []).filter((row) => row && row.is_active !== false);
  const nowRows = list.filter((row) => isRuleEffectiveNow(row));

  const exact = nowRows.find((row) => ruleBrandKey(row) === normalizedBrand);
  if (exact) return exact;

  let best = null;
  let bestLen = -1;
  for (const row of nowRows) {
    const rowKey = ruleBrandKey(row);
    if (!rowKey) continue;
    if (!brandKeysMatchForChainLookup(normalizedBrand, rowKey)) continue;
    if (rowKey.length > bestLen) {
      best = row;
      bestLen = rowKey.length;
    }
  }
  return best;
}

export async function resolveFeeRule({ brandName, supplyChainRole }) {
  const role = normalizeRole(supplyChainRole);
  if (!role) return null;
  const { data: rows, error } = await supabase
    .from('supply_chain_platform_fees')
    .select('*')
    .eq('supply_chain_role', role)
    .eq('is_active', true)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return pickFeeRuleForBrand(rows, brandName);
}

export function calculateLinePlatformFee({ lineAmount, feeRule }) {
  const amount = roundMoney(toFiniteNumber(lineAmount));
  if (amount <= 0) return 0;
  if (!feeRule) {
    const err = new Error('Platform fee rule is not configured for this brand and supply-chain role.');
    err.code = 'PLATFORM_FEE_RULE_MISSING';
    throw err;
  }

  const feeType = String(feeRule?.fee_type || 'percentage').toLowerCase();
  const feeValue = Math.max(0, toFiniteNumber(feeRule?.fee_value, 0));
  const rawFee = feeType === 'fixed' ? feeValue : (amount * feeValue) / 100;
  return roundMoney(Math.min(amount, rawFee));
}

export function calculateOrderPlatformFeeFromContext({
  orderItems = [],
  supplierProfile = {},
  feeRules = [],
  supplierId = null
}) {
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    const err = new Error('Platform fee cannot be computed because this order has no line items.');
    err.code = 'PLATFORM_FEE_ORDER_ITEMS_MISSING';
    throw err;
  }

  const roleCache = new Map();
  const ruleCache = new Map();
  let totalFee = 0;
  const breakdown = [];

  for (const item of orderItems) {
    const lineAmount = resolveLineAmount(item);
    const brandName = resolveLineBrandName(item);
    if (!String(brandName || '').trim()) {
      const err = new Error('Platform fee cannot be computed: brand is missing for one or more order items.');
      err.code = 'PLATFORM_FEE_BRAND_MISSING';
      throw err;
    }

    const brandKey = normalizeBrandKey(brandName);
    let role = roleCache.get(brandKey);
    if (role === undefined) {
      role = resolveSupplierRoleFromProfile(supplierProfile, brandName);
      roleCache.set(brandKey, role);
    }
    if (!role) {
      const err = new Error(
        `Platform fee cannot be computed: supplier role is not approved for brand "${brandName}".`
      );
      err.code = 'PLATFORM_FEE_ROLE_MISSING';
      throw err;
    }

    const ruleCacheKey = `${brandKey}::${role}`;
    let feeRule = ruleCache.get(ruleCacheKey);
    if (feeRule === undefined) {
      const roleRows = (feeRules || []).filter(
        (row) => normalizeRole(row?.supply_chain_role) === role
      );
      feeRule = pickFeeRuleForBrand(roleRows, brandName);
      ruleCache.set(ruleCacheKey, feeRule || null);
    }
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
      amount: lineAmount,
      brand: brandName,
      supplyChainRole: role,
      feeType,
      feeValue,
      feeAmount: lineFee,
      ruleId: feeRule?.id || null,
      source: 'brand_role_rule',
      supplierId: supplierId || null
    });
  }

  return {
    feeAmount: roundMoney(totalFee),
    breakdown
  };
}

export async function calculateOrderPlatformFee({
  order,
  orderItems = [],
  supplierId
}) {
  const resolvedSupplierId = supplierId || order?.supplier_id || null;
  const supplierProfile = await loadSupplierProfile(resolvedSupplierId);
  const feeRules = await loadActiveFeeRules();
  return calculateOrderPlatformFeeFromContext({
    orderItems,
    supplierProfile,
    feeRules,
    supplierId: resolvedSupplierId
  });
}

async function loadSupplierProfile(supplierId) {
  if (!supplierId) return {};
  const { data: user, error } = await supabase
    .from('users')
    .select('id, profile')
    .eq('id', supplierId)
    .maybeSingle();
  if (error) throw error;
  return user?.profile || {};
}

async function loadActiveFeeRules() {
  const { data: rows, error } = await supabase
    .from('supply_chain_platform_fees')
    .select('*')
    .eq('is_active', true)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return (rows || []).filter((row) => isRuleEffectiveNow(row));
}

async function enrichOrderItemsWithVariantBrand(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const supplierProductIds = [
    ...new Set(list.map((row) => row?.supplier_product_id).filter(Boolean))
  ];
  if (supplierProductIds.length === 0) return list;

  const { data: supplierProducts, error: supplierError } = await supabase
    .from('supplier_products')
    .select('id, attributes, product_variant_id, variant_key')
    .in('id', supplierProductIds);
  if (supplierError) {
    console.warn('[PlatformFee] supplier_products brand enrich skipped:', supplierError.message);
    return list;
  }

  const variantIds = [
    ...new Set((supplierProducts || []).map((row) => row.product_variant_id).filter(Boolean))
  ];
  let variantMap = new Map();
  if (variantIds.length > 0) {
    const { data: variants, error: variantError } = await supabase
      .from('product_variants')
      .select('id, brand')
      .in('id', variantIds);
    if (variantError) {
      console.warn('[PlatformFee] product_variants brand enrich skipped:', variantError.message);
    } else {
      variantMap = new Map((variants || []).map((row) => [row.id, row]));
    }
  }

  const supplierMap = new Map((supplierProducts || []).map((row) => [row.id, row]));
  return list.map((row) => {
    const supplierProduct = supplierMap.get(row.supplier_product_id) || null;
    const productVariant = supplierProduct?.product_variant_id
      ? variantMap.get(supplierProduct.product_variant_id) || null
      : null;
    return {
      ...row,
      supplierProduct,
      productVariant
    };
  });
}

export async function loadOrderItemsForFee(orderId) {
  const { data: rows, error } = await supabase
    .from('order_items')
    .select(`
      id,
      quantity,
      unit_price,
      total_price,
      specifications,
      supplier_product_id,
      product_id,
      product:products (
        id,
        brand,
        specifications
      )
    `)
    .eq('order_id', orderId);
  if (error) throw error;
  return enrichOrderItemsWithVariantBrand(rows || []);
}

const PLACEMENT_FEE_ERROR_CODES = new Set([
  'PLATFORM_FEE_RULE_MISSING',
  'PLATFORM_FEE_ROLE_MISSING',
  'PLATFORM_FEE_BRAND_MISSING',
  'PLATFORM_FEE_ORDER_ITEMS_MISSING'
]);

export function orderHasPlatformFeeSnapshot(order) {
  const breakdown = order?.platform_fee_breakdown;
  return Array.isArray(breakdown) && breakdown.length > 0;
}

export function resolveStoredOrComputedPlatformFee({ order, feeResult, capAmount }) {
  const computed = roundMoney(feeResult?.feeAmount);
  const chosen = orderHasPlatformFeeSnapshot(order)
    ? roundMoney(order.platform_fee_amount)
    : computed;
  return Math.min(roundMoney(capAmount), chosen);
}

async function persistFeeEconomics({
  order,
  grossAmount,
  platformFeeAmount,
  supplierPayoutAmount,
  breakdown,
  inferredRole
}) {
  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      platform_fee_amount: platformFeeAmount,
      supplier_payout_amount: supplierPayoutAmount,
      supply_chain_role_at_payment: inferredRole,
      platform_fee_breakdown: breakdown
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
        feeBreakdown: breakdown
      },
      updated_at: new Date().toISOString()
    },
    { onConflict: 'order_id' }
  );
  if (payoutError) throw payoutError;

  return updatedOrder;
}

/**
 * Compute and persist platform fee economics.
 * Called when the customer places the order so the admin brand rate is locked in
 * immediately; later payment uses this snapshot instead of a later admin edit.
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

  if (orderHasPlatformFeeSnapshot(order)) {
    const platformFeeAmount = roundMoney(order.platform_fee_amount);
    const supplierPayoutAmount = roundMoney(
      order.supplier_payout_amount ?? 0
    );
    const grossAmount = roundMoney(platformFeeAmount + supplierPayoutAmount);
    const breakdown = order.platform_fee_breakdown;
    const inferredRole =
      order.supply_chain_role_at_payment ||
      breakdown.find((line) => line.supplyChainRole)?.supplyChainRole ||
      null;
    const { data: existingPayout, error: payoutLookupError } = await supabase
      .from('supplier_payouts')
      .select('id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (payoutLookupError) throw payoutLookupError;
    if (!existingPayout) {
      const { error: payoutError } = await supabase.from('supplier_payouts').insert({
        order_id: order.id,
        supplier_id: order.supplier_id,
        gross_amount: grossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: supplierPayoutAmount,
        status: 'pending',
        metadata: { feeBreakdown: breakdown }
      });
      if (payoutError) throw payoutError;
    }
    return {
      order,
      platformFeeAmount,
      supplierPayoutAmount,
      feeBreakdown: breakdown,
      inferredRole
    };
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
  const updatedOrder = await persistFeeEconomics({
    order,
    grossAmount,
    platformFeeAmount,
    supplierPayoutAmount,
    breakdown: feeResult.breakdown,
    inferredRole
  });

  return {
    order: updatedOrder,
    platformFeeAmount,
    supplierPayoutAmount,
    feeBreakdown: feeResult.breakdown
  };
}

/** Snapshot brand platform fees as soon as the customer places the order. */
export async function snapshotPlatformFeeOnPlacedOrder({ orderId, order } = {}) {
  try {
    return await applyPlatformFeeToPaidOrder({ orderId, order });
  } catch (error) {
    if (error && PLACEMENT_FEE_ERROR_CODES.has(error.code)) {
      error.statusCode = error.statusCode || 400;
    }
    throw error;
  }
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
