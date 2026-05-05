import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { isValidPrimaryOrderStatus, toLifecycleStateFromStatus } from '../utils/orderLifecycle.js';
import logger from '../utils/logger.js';
import {
  supplierBcovLevelsUpsertSchema,
  supplierBcovResolvePriceSchema,
  supplierCategoryCreateSchema,
  supplierInventoryAdjustSchema,
  supplierNotificationReadSchema,
  supplierOutletCreateSchema,
  supplierOutletDeleteSchema,
  supplierOutletRepairGeoSchema,
  supplierOutletUpdateSchema,
  supplierOrderStatusPatchSchema,
  supplierProductAiEnhanceSchema,
  supplierProductAnalyzeImageSchema,
  supplierProductCreateSchema,
  supplierProductDeleteSchema,
  supplierProductExtractSpecificationsSchema,
  supplierProductUpdateSchema,
  supplierUpstreamCartSaveSchema,
  supplierReturnStatusPatchSchema,
  supplierUnitCreateSchema,
  supplierUpstreamOrdersSchema
} from '../contracts/supplierContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { recordInventoryMovement } from '../services/inventoryService.js';
import { applyRestockForClosedReturn } from '../services/returnInventoryService.js';
import { maybeNotifyInventoryBelowMov } from '../services/lowInventoryMovAlertService.js';
import { retrySupabaseQuery } from '../services/db.js';
import { generateAndAttachReceiptPdf } from '../services/receiptPdfService.js';
import {
  buildIdentityBundle,
  buildVariantAsinLikeId,
  normalizeVariantAttributes
} from '../services/productIdentityService.js';
import {
  validateSpecValues,
  scoreOnboardingConfidence,
  decideOnboardingAction
} from '../services/catalogOnboardingService.js';
import {
  haversineKm,
  resolveGeoFromOutletAddress,
  isValidGeoLocation,
  geocodeAddressNominatim,
  buildOutletAddressString,
  getMinDrivingDistanceFromOriginsKm
} from '../utils/geoUtils.js';
import { getMinimumOrderValueInrForSellerRole } from '../utils/supplierProfile.js';
import { fetchPendingChainRequest } from '../services/supplierChainProfileService.js';
import {
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics,
  buildOrderNetRevenueMap
} from '../utils/netRevenue.js';
import { normalizeBrandKey } from '../services/supplyChainSharedService.js';
import {
  composeBcovNotes,
  isCatalogGuardrailsEnabled,
  isValidGtin,
  normalizeBcovBrand,
  normalizeGtin,
  normalizeModelIdentifier,
  normalizeText,
  onboardingAutoApproveThreshold,
  parseBcovNotes,
  sanitizeSpecifications,
  toFiniteNumber
} from '../services/supplierCatalogHelpersService.js';
import { notifyAdminsForPortalAction } from '../services/portalActivityService.js';
import { createAdminWriteNotifyMiddleware } from '../middleware/adminWriteNotifyMiddleware.js';
import { ensureBrandApprovedOrRequest } from '../services/brandApprovalService.js';
import { insertNotification, insertNotifications } from '../repositories/notificationsRepository.js';
import { findAdmins, findUserBasicById } from '../repositories/usersRepository.js';
import { validateAndNormalizeBcovLevels } from '../services/supplierBcovService.js';
import {
  parseCovThresholdNumber,
  resolveBcovPriceForBuyerMetrics
} from '../services/procurementSharedService.js';
import { calculateMatchConfidence, extractTokens } from '../services/textMatchingService.js';
import {
  brandIsAllowedForSupplier,
  entryOverlapsViewerBrands,
  getViewerBrandTokensForRole,
  normalizeChainNameKey,
  normalizeBrandKeyFromAttributes,
  parseBrandTokens
} from '../services/supplierBrandGuardService.js';
import {
  dedupeUpstreamCandidatesBySupplierPreferClosest,
  getFirstSupplierBranchAddressText,
  minHaversineKmBuyerOutletsToSeller,
  rankUpstreamOffersForProduct,
  SUPPLY_CHAIN_ROLE_LABELS,
  UPSTREAM_RANK_PRIORITY
} from '../services/supplierUpstreamRankingService.js';
import { mapSupplyChainPartner } from '../services/supplierPartnerMapperService.js';
import {
  getImmediateParentRolesUnion,
  getMySupplierRoles,
  getViewerBrandTokensUnionForAllRoles,
  loadAdminBrandChainsByName,
  normalizeChainRolesFromStages,
  PARENT_ROLE_BY_MY_ROLE,
  pickDisplayRoleFromAllowedSet,
  pickMatchingUpstreamRoleForSeller,
  resolveRequiredUpstreamRoleFromAdminChain,
  ROLE_DEPTH,
  sellerMatchesUpstreamRoles,
  sortRolesByChainDepthDesc,
  SUPPLIER_ROLE_SET,
  userHasSupplierRole
} from '../services/supplierChainRoutingService.js';
import { shouldMoveToPendingForSpecChange } from '../utils/supplierProductApproval.js';
import { PRODUCT_IMAGES_BUCKET, uploadFile } from '../services/storage.js';

const router = express.Router();
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const ORDER_INSERT_MAX_RETRIES = 3;

const sanitizeImageUrls = (input) => {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const url = String(raw || '').trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.slice(0, 12);
};
const IGST_ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const CGST_SGST_ALLOWED_RATES = new Set([0, 2.5, 6, 9, 14]);
const CANONICAL_VARIANT_TSIN_REGEX = /^TS[A-Z0-9]{4}$/;

function resolveVariantTsin(parentAsin, variantKey, currentVariantAsin) {
  const normalizedCurrent = String(currentVariantAsin || '').trim().toUpperCase();
  if (CANONICAL_VARIANT_TSIN_REGEX.test(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return buildVariantAsinLikeId(parentAsin || '', variantKey || '');
}

function normalizeUserAddress(address = {}) {
  if (!address || typeof address !== 'object') return null;
  const line1 = String(address.line1 || address.street || '').trim();
  const line2 = String(address.line2 || address.area || '').trim();
  const city = String(address.city || '').trim();
  const state = String(address.state || '').trim();
  const zipCode = String(address.zipCode || address.pincode || address.postalCode || '').trim();
  const country = String(address.country || '').trim();

  return {
    ...address,
    street: line1,
    line1,
    line2,
    city,
    state,
    zipCode,
    pincode: zipCode,
    country
  };
}

function parseTaxRate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return NaN;
  return Number(parsed.toFixed(2));
}

function validateAndNormalizeTaxRates(input = {}) {
  const igstRate = parseTaxRate(input.igst_rate ?? input.igstRate);
  const cgstRate = parseTaxRate(input.cgst_rate ?? input.cgstRate);
  const sgstRate = parseTaxRate(input.sgst_rate ?? input.sgstRate);

  const anyProvided = [igstRate, cgstRate, sgstRate].some((v) => v !== null);
  if (!anyProvided) {
    return {
      ok: true,
      data: { igstRate: null, cgstRate: null, sgstRate: null }
    };
  }

  if ([igstRate, cgstRate, sgstRate].some((v) => Number.isNaN(v))) {
    return {
      ok: false,
      message: 'Invalid tax rate value. Select values from the provided dropdown options only.'
    };
  }

  if (igstRate === null || cgstRate === null || sgstRate === null) {
    return {
      ok: false,
      message: 'IGST, CGST, and SGST are all required together.'
    };
  }

  if (!IGST_ALLOWED_RATES.has(igstRate)) {
    return {
      ok: false,
      message: 'Invalid IGST rate. Allowed values are 0, 5, 12, 18, and 28.'
    };
  }
  if (!CGST_SGST_ALLOWED_RATES.has(cgstRate) || !CGST_SGST_ALLOWED_RATES.has(sgstRate)) {
    return {
      ok: false,
      message: 'Invalid CGST/SGST rate. Allowed values are 0, 2.5, 6, 9, and 14.'
    };
  }
  if (cgstRate !== sgstRate) {
    return {
      ok: false,
      message: 'CGST and SGST must be the same percentage.'
    };
  }
  if (Number((cgstRate + sgstRate).toFixed(2)) !== igstRate) {
    return {
      ok: false,
      message: 'IGST must equal CGST + SGST.'
    };
  }

  return {
    ok: true,
    data: { igstRate, cgstRate, sgstRate }
  };
}

async function fetchLatestTaxRatesForProduct(productId) {
  if (!productId) return null;
  const { data } = await supabase
    .from('supplier_products')
    .select('igst_rate, cgst_rate, sgst_rate, updated_at')
    .eq('product_id', productId)
    .not('igst_rate', 'is', null)
    .not('cgst_rate', 'is', null)
    .not('sgst_rate', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    igstRate: Number(data.igst_rate),
    cgstRate: Number(data.cgst_rate),
    sgstRate: Number(data.sgst_rate)
  };
}

async function fetchLatestTaxRatesForCategory(categoryName) {
  const normalizedCategory = String(categoryName || '').trim().toLowerCase();
  if (!normalizedCategory) return null;

  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('category', normalizedCategory)
    .limit(100);
  const productIds = (products || []).map((p) => p.id).filter(Boolean);
  if (!productIds.length) return null;

  const { data } = await supabase
    .from('supplier_products')
    .select('igst_rate, cgst_rate, sgst_rate, updated_at')
    .in('product_id', productIds)
    .not('igst_rate', 'is', null)
    .not('cgst_rate', 'is', null)
    .not('sgst_rate', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    igstRate: Number(data.igst_rate),
    cgstRate: Number(data.cgst_rate),
    sgstRate: Number(data.sgst_rate)
  };
}

async function resolveTaxRatesForProductCreate({
  input = {},
  preferredProductId = null,
  categoryName = ''
} = {}) {
  const explicitValidation = validateAndNormalizeTaxRates(input);
  if (!explicitValidation.ok) return explicitValidation;

  // If the user explicitly sent all three rates, preserve them.
  if (explicitValidation.data.igstRate !== null) {
    return explicitValidation;
  }

  // Reuse the latest configured rates from the same product if available.
  const byProduct = await fetchLatestTaxRatesForProduct(preferredProductId);
  if (byProduct) {
    return { ok: true, data: byProduct };
  }

  // Otherwise infer from the same category to minimize repetitive data entry.
  const byCategory = await fetchLatestTaxRatesForCategory(categoryName);
  if (byCategory) {
    return { ok: true, data: byCategory };
  }

  return explicitValidation;
}

const isOrderNumberConflictError = (error) => {
  if (!error) return false;
  if (error.code === '23505') {
    const details = String(error.details || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();
    return details.includes('order_number') || message.includes('order_number');
  }
  return false;
};

const isRevenueRecognizedOrder = (order) => {
  const paymentStatus = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  return paymentStatus === 'paid' && status !== 'cancelled' && status !== 'returned';
};

// Auto-notify admins on all successful write actions from this router.
router.use(createAdminWriteNotifyMiddleware({ supabase, notifyAdminsForPortalAction }));

// ========== Fuzzy Matching Helper Functions ==========


async function upsertModelSpecProfile({
  category,
  modelRaw,
  specifications,
  actorUserId
}) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const modelIdentifier = normalizeModelIdentifier(modelRaw);
  const safeSpecs = sanitizeSpecifications(specifications);

  if (!normalizedCategory || !modelIdentifier || Object.keys(safeSpecs).length === 0) {
    return null;
  }

  const payload = {
    category: normalizedCategory,
    model_identifier: modelIdentifier,
    display_model: String(modelRaw || '').trim() || modelIdentifier,
    specifications: safeSpecs,
    updated_by: actorUserId || null
  };

  const { data, error } = await supabase
    .from('model_spec_profiles')
    .upsert(payload, { onConflict: 'category,model_identifier' })
    .select('*')
    .single();

  if (error) {
    console.error('[Model Specs] upsert error:', error);
    return null;
  }

  return data;
}

async function loadSpecTemplateForCategory(category, familyId = null) {
  const categoryValue = String(category || '').trim().toLowerCase();
  if (!categoryValue) return { template: null, fields: [] };

  let query = supabase
    .from('spec_templates')
    .select('*')
    .eq('category', categoryValue)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (familyId) {
    query = query.eq('family_id', familyId);
  } else {
    query = query.is('family_id', null);
  }

  const { data: template } = await query.maybeSingle();
  if (!template) return { template: null, fields: [] };

  const { data: fields } = await supabase
    .from('spec_template_fields')
    .select('*')
    .eq('template_id', template.id)
    .order('sort_order', { ascending: true });

  return { template, fields: fields || [] };
}


// ========== End Fuzzy Matching Functions ==========

// Check if supplier has completed initial setup (has at least one product/offer)
router.get('/setup-status', authenticateToken, async (req, res) => {
  try {
    // Prefer supplier_products (new multi-supplier model)
    const { count, error } = await supabase
      .from('supplier_products')
      .select('*', { count: 'exact', head: true })
      .eq('supplier_id', req.userId);
    
    if (error) {
      // Fallback: count legacy products owned by this supplier
      const { count: legacyCount, error: legacyError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('supplier_id', req.userId);

      if (legacyError) {
        throw legacyError;
      }

      return res.json({
        status: 'success',
        hasProducts: (legacyCount || 0) > 0,
        productCount: legacyCount || 0
      });
    }
    
    res.json({ 
      status: 'success',
      hasProducts: (count || 0) > 0,
      productCount: count || 0
    });
  } catch (error) {
    console.error('Get setup status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.get('/supply-chain-partners', authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== 'supplier') {
      return res.status(403).json({
        status: 'error',
        message: 'Only suppliers can view supply chain partners'
      });
    }

    const pendingChainRequest = await fetchPendingChainRequest(req.userId);
    const pendingPayload = pendingChainRequest?.payload || null;
    const effectiveViewerProfile = pendingPayload
      ? {
          ...(req.user.profile || {}),
          supplierRole: String(pendingPayload?.supplierRole || '').trim(),
          brands: typeof pendingPayload?.brands === 'string' ? pendingPayload.brands : '',
          companyInfoEntries: Array.isArray(pendingPayload?.companyInfoEntries)
            ? pendingPayload.companyInfoEntries
            : []
        }
      : req.user.profile;

    const previewRole = (req.query.previewRole || '').trim();
    const myRoles = getMySupplierRoles(effectiveViewerProfile, previewRole);

    if (myRoles.length === 0) {
      return res.json({
        status: 'success',
        yourRole: null,
        yourRoleLabel: null,
        parentRole: null,
        parentRoleLabel: null,
        partners: [],
        partnerGroups: [],
        message:
          'Select your business type (MGF, Stockist, …) in Profile to see partners one step above you in the chain.'
      });
    }

    const sortedMyRoles = sortRolesByChainDepthDesc(myRoles);
    const onlyManufacturers = sortedMyRoles.length === 1 && sortedMyRoles[0] === 'manufacturer';
    if (onlyManufacturers) {
      const mr = sortedMyRoles[0];
      return res.json({
        status: 'success',
        yourRole: mr,
        yourRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[mr] || mr,
        parentRole: null,
        parentRoleLabel: null,
        partners: [],
        partnerGroups: [],
        message:
          'As a manufacturer (MGF) you are at the top of the supply chain — there are no upstream partners to list here.'
      });
    }

    const { data: rows, error } = await supabase
      .from('users')
      .select('id, name, company, phone, email, address, profile')
      .eq('user_type', 'supplier')
      .eq('is_active', true)
      .neq('id', req.userId);

    if (error) {
      throw error;
    }

    const allRows = rows || [];
    const partnerGroups = [];
    const seenParentRole = new Set();

    const viewerRoles = getMySupplierRoles(effectiveViewerProfile, '');
    const viewerBrandTokensByRole = new Map();
    const allViewerBrandTokens = new Set();
    for (const role of viewerRoles) {
      const tokens = getViewerBrandTokensForRole(effectiveViewerProfile, role);
      viewerBrandTokensByRole.set(role, tokens);
      for (const t of tokens) allViewerBrandTokens.add(t);
    }
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: [...allViewerBrandTokens]
    });

    for (const myRole of sortedMyRoles) {
      const viewerBrandTokens = viewerBrandTokensByRole.get(myRole) || new Set();
      const allowedParentRolesSet = new Set();
      for (const token of viewerBrandTokens) {
        const chainRow = adminBrandChainMap.get(normalizeChainNameKey(token));
        const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);
        const idx = chainRoles.indexOf(myRole);
        if (idx > 0) {
          allowedParentRolesSet.add(chainRoles[idx - 1]);
        }
      }
      if (allowedParentRolesSet.size === 0) {
        const fallbackParentRole = PARENT_ROLE_BY_MY_ROLE[myRole];
        if (fallbackParentRole) allowedParentRolesSet.add(fallbackParentRole);
      }
      const parentRole = pickDisplayRoleFromAllowedSet(allowedParentRolesSet);
      if (!parentRole || seenParentRole.has(parentRole)) continue;
      seenParentRole.add(parentRole);

      const partners = allRows
        .map((u) => {
          if (!u.profile) return null;
          const matchedRole = pickMatchingUpstreamRoleForSeller(u.profile, allowedParentRolesSet);
          if (!matchedRole) return null;
          return mapSupplyChainPartner(u, matchedRole, viewerBrandTokens);
        })
        .filter(Boolean);

      const label = SUPPLY_CHAIN_ROLE_LABELS[parentRole] || parentRole;
      partnerGroups.push({
        yourRole: myRole,
        yourRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[myRole] || myRole,
        parentRole,
        parentRoleLabel: label,
        partners,
        message:
          partners.length === 0
            ? viewerBrandTokens.size > 0
              ? `No ${label} match the brands you listed for your ${SUPPLY_CHAIN_ROLE_LABELS[myRole] || myRole} profile yet. Use the same brand names as in your registration, or clear brands on that role to see all ${label}.`
              : `No registered ${label} yet. They will appear here once they sign up and set their role.`
            : null
      });
    }

    const first = partnerGroups[0];
    return res.json({
      status: 'success',
      yourRole: first?.yourRole ?? null,
      yourRoleLabel: first?.yourRoleLabel ?? null,
      parentRole: first?.parentRole ?? null,
      parentRoleLabel: first?.parentRoleLabel ?? null,
      partners: first?.partners ?? [],
      partnerGroups,
      message: partnerGroups.every((g) => g.partners.length === 0)
        ? partnerGroups.map((g) => g.message).filter(Boolean)[0] || null
        : null
    });
  } catch (err) {
    console.error('supply-chain-partners error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load supply chain partners'
    });
  }
});

// BCOV levels (brand-wise quantity slabs -> unit price)
router.get('/bcov-levels', authenticateToken, async (req, res) => {
  try {
    const scopeKey = String(req.query.scopeKey || '').trim();
    const normalizedScopeKey = normalizeBcovBrand(scopeKey);

    let query = supabase
      .from('supplier_bcov_levels')
      .select('id, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .order('normalized_brand', { ascending: true })
      .order('min_purchase_qty', { ascending: true });

    if (normalizedScopeKey) {
      query = query.eq('normalized_brand', normalizedScopeKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({
      status: 'success',
      levels: (data || []).map((r) => {
        const parsedNotes = parseBcovNotes(r.notes);
        return {
          id: r.id,
          brand: r.brand_name,
          levelName: parsedNotes.levelName,
          buyerBcov: parsedNotes.buyerBcov,
          buyerCov: Number(r.min_purchase_qty),
          buyerPcov: r.max_purchase_qty == null ? null : Number(r.max_purchase_qty),
          minPurchaseQty: Number(r.min_purchase_qty),
          maxPurchaseQty: r.max_purchase_qty == null ? null : Number(r.max_purchase_qty),
          price: Number(r.unit_price),
          notes: parsedNotes.rawNotes
        };
      })
    });
  } catch (error) {
    console.error('Get BCOV levels error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load BCOV levels' });
  }
});

router.put('/bcov-levels', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierBcovLevelsUpsertSchema, req.body || {});
    const scopeKey = String(payloadInput.scopeKey || '').trim();
    const normalizedScopeKey = normalizeBcovBrand(scopeKey);
    const parsed = validateAndNormalizeBcovLevels(payloadInput.levels || []);
    if (!parsed.ok) {
      return res.status(400).json({ status: 'error', message: parsed.message });
    }

    if (normalizedScopeKey) {
      const hasOutOfScopeBrand = parsed.levels.some((row) => row.normalizedBrand !== normalizedScopeKey);
      if (hasOutOfScopeBrand) {
        return res.status(400).json({
          status: 'error',
          message: 'All Product_COV rows must belong to the selected product/brand scope.'
        });
      }
    }

    const payload = parsed.levels.map((row) => ({
      supplier_id: req.userId,
      brand_name: row.brand,
      normalized_brand: row.normalizedBrand,
      min_purchase_qty: row.minPurchaseQty,
      max_purchase_qty: row.maxPurchaseQty,
      unit_price: row.price,
      notes: row.notes
    }));

    let deleteQuery = supabase
      .from('supplier_bcov_levels')
      .delete()
      .eq('supplier_id', req.userId);
    if (normalizedScopeKey) {
      deleteQuery = deleteQuery.eq('normalized_brand', normalizedScopeKey);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;

    if (payload.length > 0) {
      const { error: insertError } = await supabase
        .from('supplier_bcov_levels')
        .insert(payload);
      if (insertError) throw insertError;
    }

    return res.json({
      status: 'success',
      message: 'BCOV levels saved successfully',
      count: payload.length
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save BCOV levels error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save BCOV levels' });
  }
});

router.post('/bcov-levels/resolve-price', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierBcovResolvePriceSchema, req.body || {});
    const brand = String(payloadInput.brand || '').trim();
    const normalizedBrand = normalizeBcovBrand(brand);
    const legacyPurchaseQty = toFiniteNumber(payloadInput.purchaseQty);
    const supplierCov = toFiniteNumber(payloadInput.supplierCov);
    const platformCov = toFiniteNumber(payloadInput.platformCov);
    const brandCov = toFiniteNumber(payloadInput.brandCov);
    const effectiveSupplierCov = supplierCov ?? legacyPurchaseQty;
    const effectivePlatformCov = platformCov ?? legacyPurchaseQty;
    const effectiveBrandCov = brandCov ?? legacyPurchaseQty;

    if (!normalizedBrand) {
      return res.status(400).json({ status: 'error', message: 'brand is required' });
    }
    if (effectiveSupplierCov === null || effectiveSupplierCov < 0) {
      return res.status(400).json({ status: 'error', message: 'supplierCov must be 0 or more' });
    }
    if (effectivePlatformCov === null || effectivePlatformCov < 0) {
      return res.status(400).json({ status: 'error', message: 'platformCov must be 0 or more' });
    }
    if (effectiveBrandCov === null || effectiveBrandCov < 0) {
      return res.status(400).json({ status: 'error', message: 'brandCov must be 0 or more' });
    }

    const { data, error } = await supabase
      .from('supplier_bcov_levels')
      .select('id, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .eq('normalized_brand', normalizedBrand)
      .order('min_purchase_qty', { ascending: false });

    if (error) throw error;

    const levels = data || [];
    const matched = resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov: effectiveSupplierCov,
      platformCov: effectivePlatformCov,
      brandCov: effectiveBrandCov
    });

    if (!matched) {
      return res.json({
        status: 'success',
        result: {
          matched: false,
          brand,
          supplierCov: effectiveSupplierCov,
          platformCov: effectivePlatformCov,
          brandCov: effectiveBrandCov
        }
      });
    }

    const matchedLevel = levels.find((row) => row.id === matched.levelId) || null;
    const parsedNotes = parseBcovNotes(matchedLevel?.notes);
    const supplierCovThreshold = parseCovThresholdNumber(parsedNotes.buyerBcov);
    const brandCovThreshold = toFiniteNumber(matchedLevel?.min_purchase_qty);
    const platformCovThreshold = toFiniteNumber(matchedLevel?.max_purchase_qty);
    return res.json({
      status: 'success',
      result: {
        matched: true,
        levelId: matched.levelId,
        brand: matchedLevel?.brand_name || brand,
        supplierCov: effectiveSupplierCov,
        platformCov: effectivePlatformCov,
        brandCov: effectiveBrandCov,
        levelName: parsedNotes.levelName,
        buyerBcov: parsedNotes.buyerBcov,
        buyerCov: brandCovThreshold,
        buyerPcov: platformCovThreshold,
        minPurchaseQty: brandCovThreshold,
        maxPurchaseQty: platformCovThreshold,
        supplierCovThreshold,
        platformCovThreshold,
        brandCovThreshold,
        appliedBy:
          supplierCovThreshold !== null && effectiveSupplierCov >= supplierCovThreshold
            ? 'supplier'
            : brandCovThreshold !== null && effectiveBrandCov >= brandCovThreshold
            ? 'brand'
            : 'platform',
        price: matched.price,
        notes: parsedNotes.rawNotes || null
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Resolve BCOV price error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to resolve BCOV price' });
  }
});

// Get all products for a supplier (including pending, approved, and rejected)
router.get('/products', authenticateToken, async (req, res) => {
  try {
    // Fetch products with supplier_products join
    const { data: supplierProducts, error: supplierProductsError } = await supabase
      .from('supplier_products')
      .select(`
        *,
        product:products(*)
      `)
      .eq('supplier_id', req.userId)
      // If admin rejects a product, we update supplier_products.status = 'rejected'
      // and we want the rejected item to disappear from the supplier portal.
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });
    
    if (supplierProductsError) {
      // Fallback: try fetching from products table (for backward compatibility)
      console.log('Error fetching from supplier_products, trying products table:', supplierProductsError);
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('supplier_id', req.userId)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
      
      return res.json({ 
        status: 'success',
        products: products || []
      });
    }
    
    // Combine product and supplier_products data.
    // If an admin deletes the shared product but a junction row remains (unexpected legacy data),
    // skip the row so the supplier UI doesn't show "ghost" products.
    const products = (supplierProducts || [])
      .map(sp => {
        if (!sp.product) return null;

        const baseSpecs =
          sp.product?.specifications && typeof sp.product.specifications === 'object'
            ? sp.product.specifications
            : {};
        const offerSpecs =
          sp.attributes?.specifications && typeof sp.attributes.specifications === 'object'
            ? sp.attributes.specifications
            : {};
        const mergedSpecs = { ...baseSpecs, ...offerSpecs };
        const offerImages = sanitizeImageUrls(sp.attributes?.images);
        const baseImages = sanitizeImageUrls(sp.product?.images);

        return {
          ...sp.product,
          // Per-variant display: offer overrides shared catalog (same merge as PUT response)
          name:
            (sp.attributes?.listingName != null && String(sp.attributes.listingName).trim() !== '')
              ? String(sp.attributes.listingName).trim()
              : sp.product.name,
          description:
            sp.attributes && Object.prototype.hasOwnProperty.call(sp.attributes, 'description')
              ? sp.attributes.description
              : (sp.product.description ?? ''),
          brand: sp.attributes?.brand || sp.product.brand,
          gtin: sp.attributes?.gtin || sp.product.gtin,
          mpn: sp.attributes?.mpn || sp.product.mpn,
          specifications: mergedSpecs,
          images: offerImages.length > 0 ? offerImages : baseImages,
          price: sp.price,
          stock: sp.stock,
          igst_rate: sp.igst_rate ?? sp.attributes?.igstRate ?? null,
          cgst_rate: sp.cgst_rate ?? sp.attributes?.cgstRate ?? null,
          sgst_rate: sp.sgst_rate ?? sp.attributes?.sgstRate ?? null,
          location: sp.location,
          min_order_quantity: sp.min_order_quantity,
          // Reconcile status with admin approval:
          // If the shared product is approved, but supplier_products row is still pending
          // (can happen for legacy data / race conditions), show it as approved in UI.
          status:
            (sp.status === 'pending' || sp.status === null || sp.status === undefined || sp.status === '')
            && sp.product?.status === 'approved'
              ? 'approved'
              : sp.status,
          is_active:
            (sp.status === 'pending' || sp.status === null || sp.status === undefined || sp.status === '')
            && sp.product?.status === 'approved'
              ? true
              : sp.is_active,
          rejection_reason: sp.rejection_reason,
          approved_by: sp.approved_by,
          approved_at: sp.approved_at,
          supplier_id: sp.supplier_id,
          variantKey: sp.variant_key,
          variantAsin: resolveVariantTsin(sp.product?.asin, sp.variant_key, sp.variant_asin),
          brandModel: sp.attributes?.brandModel,
          lsa: sp.attributes?.lsa,
          hsnCode: sp.attributes?.hsnCode,
          supplier_product_id: sp.id // Include junction table ID
        };
      })
      .filter(Boolean);
    
    res.json({ 
      status: 'success',
      products: products || []
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.post(
  '/products/upload-image',
  authenticateToken,
  productImageUpload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'Image file is required' });
      }
      if (!String(req.file.mimetype || '').startsWith('image/')) {
        return res.status(400).json({ status: 'error', message: 'Only image files are allowed' });
      }

      const supplierProductId = String(req.body?.supplierProductId || '').trim() || 'draft';
      const safeOriginalName = String(req.file.originalname || 'product-image.jpg')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${req.userId}/${supplierProductId}/${Date.now()}-${safeOriginalName}`;
      const { url } = await uploadFile(PRODUCT_IMAGES_BUCKET, path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

      return res.status(201).json({
        status: 'success',
        message: 'Product image uploaded successfully',
        url
      });
    } catch (error) {
      console.error('Product image upload error:', error);
      return res.status(500).json({
        status: 'error',
        message:
          error?.message && String(error.message).includes('Bucket not found')
            ? `${error.message} Set SUPABASE_STORAGE_PRODUCT_BUCKET in backend .env and restart server.`
            : 'Failed to upload product image'
      });
    }
  }
);

// ================= OUTLETS & LOCATIONS =================

// CRUD for supplier outlets (stores / warehouses)

// List outlets for the logged-in supplier
router.get('/outlets', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('outlets')
      .select('*')
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlets: data || []
    });
  } catch (error) {
    console.error('Get outlets error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Create a new outlet
router.post('/outlets', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierOutletCreateSchema, req.body || {});
    const { name, type, code, address, geo_location, phone, email, metadata } = payloadInput;

    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Outlet name is required'
      });
    }

    let finalGeo = isValidGeoLocation(geo_location) ? { lat: geo_location.lat, lng: geo_location.lng } : null;
    if (!finalGeo) {
      const resolved = await resolveGeoFromOutletAddress(null, address || {});
      if (resolved) finalGeo = resolved;
    }

    const { data, error } = await supabase
      .from('outlets')
      .insert({
        supplier_id: req.userId,
        name: name.trim(),
        type: type || 'store',
        code: code || null,
        address: address || {},
        geo_location: finalGeo,
        phone: phone || null,
        email: email || null,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update an outlet (only if it belongs to the logged-in supplier)
router.put('/outlets/:id', authenticateToken, async (req, res) => {
  try {
    const outletId = req.params.id;
    const payloadInput = parseWithSchema(supplierOutletUpdateSchema, req.body || {});
    const { name, type, code, address, geo_location, phone, email, metadata, is_active } = payloadInput;

    // Ensure outlet belongs to supplier
    const { data: existing, error: fetchError } = await supabase
      .from('outlets')
      .select('*')
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        status: 'error',
        message: 'Outlet not found'
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (code !== undefined) updateData.code = code;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (is_active !== undefined) updateData.is_active = !!is_active;

    const mergedAddress = address !== undefined ? address : existing.address;
    let finalGeo;
    let geoExplicitlyCleared = false;
    if (geo_location !== undefined) {
      if (geo_location === null) {
        geoExplicitlyCleared = true;
        finalGeo = null;
      } else {
        finalGeo = isValidGeoLocation(geo_location) ? { lat: geo_location.lat, lng: geo_location.lng } : null;
      }
    } else {
      finalGeo = existing.geo_location;
    }
    if (!geoExplicitlyCleared && !isValidGeoLocation(finalGeo)) {
      const resolved = await resolveGeoFromOutletAddress(null, mergedAddress || {});
      if (resolved) finalGeo = resolved;
    }
    updateData.geo_location = finalGeo;

    const { data, error } = await supabase
      .from('outlets')
      .update(updateData)
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

/**
 * Backfill geo_location for outlets that have address but missing/invalid coordinates.
 * Uses GOOGLE_GEOCODING_API_KEY (or Nominatim fallback) — run after setting the key or fixing addresses.
 */
router.post('/outlets/repair-geo', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierOutletRepairGeoSchema, req.body || {});
    const { data: outlets, error } = await supabase
      .from('outlets')
      .select('id, address, geo_location')
      .eq('supplier_id', req.userId)
      .eq('is_active', true);

    if (error) throw error;

    const results = { updated: 0, skipped: 0, failed: [] };

    for (const o of outlets || []) {
      if (isValidGeoLocation(o.geo_location)) {
        results.skipped += 1;
        continue;
      }
      const resolved = await resolveGeoFromOutletAddress(null, o.address || {});
      if (!resolved) {
        results.failed.push({ outletId: o.id, reason: 'no_geocode_result' });
        continue;
      }
      const { error: upErr } = await supabase
        .from('outlets')
        .update({ geo_location: resolved })
        .eq('id', o.id)
        .eq('supplier_id', req.userId);

      if (upErr) {
        results.failed.push({ outletId: o.id, reason: upErr.message });
      } else {
        results.updated += 1;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return res.json({
      status: 'success',
      message:
        results.updated > 0
          ? `Updated coordinates for ${results.updated} outlet(s). Upstream distance ranking will use them on the next suggestions request.`
          : 'No outlets needed updates (or geocoding returned no results).',
      results
    });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('Repair outlet geo error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to repair outlet coordinates' });
  }
});

// Soft delete an outlet (mark inactive)
router.delete('/outlets/:id', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierOutletDeleteSchema, req.body || {});
    const outletId = req.params.id;

    const { data, error } = await supabase
      .from('outlets')
      .update({ is_active: false })
      .eq('id', outletId)
      .eq('supplier_id', req.userId)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        status: 'error',
        message: 'Outlet not found'
      });
    }

    res.json({
      status: 'success',
      outlet: data
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Delete outlet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get supplier locations (combined outlets + legacy profile branches)
router.get('/locations', authenticateToken, async (req, res) => {
  try {
    // City code generation: Amazon-style "Ban-123" identifiers.
    // This must be independent from supplier outlet/store codes.
    const inferCityCode = (cityName) => {
      const raw = (cityName || '').toString().trim();
      if (!raw) return '';

      // Use first 3 letters as prefix (e.g., Bangalore => Ban).
      const prefixRaw = raw.replace(/[^a-zA-Z]/g, '').slice(0, 3);
      const prefix =
        prefixRaw.length > 0
          ? prefixRaw.charAt(0).toUpperCase() + prefixRaw.slice(1).toLowerCase()
          : 'City';

      // Stable numeric suffix derived from city name.
      let h = 0;
      for (let i = 0; i < raw.length; i++) {
        h = (h * 31 + raw.charCodeAt(i)) % 1000000;
      }
      const suffix = 100 + (h % 900); // 100..999
      return `${prefix}-${suffix}`;
    };

    // 1) Fetch outlets for this supplier
    const { data: outlets, error: outletsError } = await supabase
      .from('outlets')
      .select('*')
      .eq('supplier_id', req.userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (outletsError) {
      console.error('Get locations - outlets error:', outletsError);
    }

    const outletLocations = (outlets || []).map(outlet => {
      const addr = outlet.address || {};
      const addressText = [
        addr.street,
        addr.city,
        addr.state,
        addr.zipCode,
        addr.country
      ].filter(Boolean).join(', ');

      const displayText = outlet.name || addressText || outlet.code || 'Outlet';

      return {
        id: outlet.id,
        type: 'outlet',
        name: outlet.name || '',
        code: '',
        address: addressText,
        displayText,
        fullText: addressText ? `${outlet.name || ''}${outlet.name ? ', ' : ''}${addressText}` : displayText
      };
    });

    // 2) Fetch legacy branches from user profile for backward compatibility
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('profile')
      .eq('id', req.userId)
      .single();
    
    if (userError) {
      console.error('Get locations - user branches error:', userError);
    }
    
    const branches = user?.profile?.branches || [];
    
    const branchLocations = branches.map(branch => {
      const parts = [
        branch.address && branch.address.trim(),
        branch.city && branch.city.trim(),
        branch.state && branch.state.trim(),
        branch.zipCode && branch.zipCode.trim(),
        branch.country && branch.country.trim()
      ].filter(Boolean);
      const locationText = parts.join(', ') || branch.name?.trim() || '';
      const displayText = locationText || `Branch ${branch.id}`;

      return {
        id: branch.id,
        type: 'branch',
        name: branch.name || '',
        code: '',
        address: branch.address || '',
        displayText,
        fullText: branch.name && branch.address 
          ? `${branch.name}, ${branch.address}` 
          : displayText
      };
    }).filter(loc => loc.displayText);
    
    const locations = [...outletLocations, ...branchLocations];
    
    res.json({ 
      status: 'success',
      locations
    });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Search for product name suggestions (autocomplete) with fuzzy matching
router.get('/products/search', authenticateToken, async (req, res) => {
  try {
    const { q, category } = req.query;
    const parsedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : 20;
    const normalizedCategory = String(category || '').trim().toLowerCase();
    const query = String(q || '').trim();

    // Return existing approved catalog products with enough fields for rich dropdown details.
    let productsQuery = supabase
      .from('products')
      .select('id, name, category, unit, description, brand, gtin, barcode, specifications, status, is_active, updated_at')
      .eq('is_active', true)
      .eq('status', 'approved');
    if (normalizedCategory) {
      productsQuery = productsQuery.eq('category', normalizedCategory);
    }
    if (query) {
      const ilikeQuery = `%${query.replace(/\s+/g, '%')}%`;
      productsQuery = productsQuery.or(`name.ilike.${ilikeQuery},brand.ilike.${ilikeQuery},description.ilike.${ilikeQuery}`);
    }
    const { data: matchedProducts, error } = await productsQuery
      .order('updated_at', { ascending: false })
      .limit(query ? 50 : limit);
    
    if (error) {
      console.error('Error fetching products for search:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }

    if (!matchedProducts || matchedProducts.length === 0) {
      return res.json({
        status: 'success',
        suggestions: []
      });
    }

    // Enrich product specs with the latest approved supplier-entered spec values.
    // This ensures dropdown selection returns filled key-value pairs, not only template keys.
    const matchedProductIds = [...new Set((matchedProducts || []).map((p) => p.id).filter(Boolean))];
    const bestSpecsByProductId = new Map();
    if (matchedProductIds.length > 0) {
      const { data: approvedOffers } = await supabase
        .from('supplier_products')
        .select('product_id, attributes, updated_at')
        .in('product_id', matchedProductIds)
        .eq('status', 'approved')
        .eq('is_active', true)
        .order('updated_at', { ascending: false });

      const nonEmptyValueCount = (specsObj) =>
        Object.values(specsObj || {}).filter((v) => String(v ?? '').trim() !== '').length;

      for (const row of approvedOffers || []) {
        const pid = row?.product_id;
        const specs =
          row?.attributes?.specifications &&
          typeof row.attributes.specifications === 'object' &&
          !Array.isArray(row.attributes.specifications)
            ? row.attributes.specifications
            : null;
        if (!pid || !specs) continue;
        const existing = bestSpecsByProductId.get(pid);
        if (!existing) {
          bestSpecsByProductId.set(pid, specs);
          continue;
        }
        // Prefer the specs payload that contains more non-empty values.
        if (nonEmptyValueCount(specs) > nonEmptyValueCount(existing)) {
          bestSpecsByProductId.set(pid, specs);
        }
      }
    }

    const resolveSuggestionSpecifications = (product) => {
      const baseSpecs =
        product.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications)
          ? product.specifications
          : {};
      const supplierSpecs = bestSpecsByProductId.get(product.id) || {};
      const merged = { ...baseSpecs };
      Object.keys(supplierSpecs || {}).forEach((k) => {
        const supplierValue = supplierSpecs[k];
        if (String(supplierValue ?? '').trim() !== '') {
          merged[k] = supplierValue;
        } else if (!Object.prototype.hasOwnProperty.call(merged, k)) {
          merged[k] = supplierValue;
        }
      });
      return merged;
    };

    if (!query) {
      const discoverySuggestions = matchedProducts
        .slice(0, limit)
        .map((product) => ({
          ...product,
          specifications: resolveSuggestionSpecifications(product)
        }));
      return res.json({
        status: 'success',
        suggestions: discoverySuggestions
      });
    }

    // Rank results so typing starting letters surfaces best matches first.
    const queryLower = query.toLowerCase();
    const ranked = matchedProducts
      .map((product) => {
        const name = String(product.name || '');
        const nameLower = name.toLowerCase();
        const brandLower = String(product.brand || '').toLowerCase();
        let score = 0;

        if (nameLower === queryLower) score += 150;
        if (nameLower.startsWith(queryLower)) score += 120;
        else if (nameLower.includes(queryLower)) score += 80;

        if (brandLower.startsWith(queryLower)) score += 40;
        else if (brandLower.includes(queryLower)) score += 20;

        // Keep fuzzy scoring as a tiebreaker for close matches.
        score += Math.round(
          calculateMatchConfidence(query, name, product.description || '') * 10
        );

        return { ...product, score };
      })
      .filter((product) => product.score > 0)
      .sort((a, b) => {
        // Primary sort: score (descending)
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        // Secondary sort: most recently updated
        const aTime = new Date(a.updated_at || 0).getTime();
        const bTime = new Date(b.updated_at || 0).getTime();
        if (bTime !== aTime) {
          return bTime - aTime;
        }
        // Third sort: name
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20)
      .map(({ score, ...product }) => ({
        ...product,
        specifications: resolveSuggestionSpecifications(product)
      }));

    // Deduplicate by id (or fallback key) and return top 10.
    const uniqueMap = new Map();
    for (const product of ranked) {
      const key = product.id || `${String(product.name || '').toLowerCase()}|${String(product.category || '').toLowerCase()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, product);
      }
    }

    const finalSuggestions = Array.from(uniqueMap.values()).slice(0, 10);
    
    console.log(`Product search for "${q}": Found ${finalSuggestions.length} fuzzy-matched suggestions`);

    res.json({
      status: 'success',
      suggestions: finalSuggestions
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Lookup a product by exact name + category and return its unit (for auto-fill)
router.get('/products/lookup', authenticateToken, async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const category = String(req.query.category || '').trim().toLowerCase();

    if (!name || !category) {
      return res.json({
        status: 'success',
        found: false
      });
    }

    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, category, unit')
      .eq('category', category)
      .ilike('name', name)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Product lookup error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }

    const product = products && products.length > 0 ? products[0] : null;

    // If product exists, calculate recommended price as average of all suppliers' prices
    // Prefer excluding the current supplier (so they see market average) when possible.
    let recommendedPrice = null;
    let avgPriceAll = null;
    let avgPriceOthers = null;
    let supplierCountAll = 0;
    let supplierCountOthers = 0;
    let minPrice = null;
    let maxPrice = null;

    if (product?.id) {
      const { data: supplierOffers, error: offersError } = await supabase
        .from('supplier_products')
        .select('price, supplier_id, status, is_active')
        .eq('product_id', product.id)
        .eq('is_active', true)
        .eq('status', 'approved');

      if (offersError) {
        console.error('Recommended price lookup error:', offersError);
      } else {
        const offers = (supplierOffers || [])
          .map(o => ({
            price: typeof o.price === 'string' ? parseFloat(o.price) : Number(o.price),
            supplier_id: o.supplier_id
          }))
          .filter(o => Number.isFinite(o.price) && o.price >= 0);

        supplierCountAll = offers.length;
        if (supplierCountAll > 0) {
          const sumAll = offers.reduce((sum, o) => sum + o.price, 0);
          avgPriceAll = sumAll / supplierCountAll;
          minPrice = Math.min(...offers.map(o => o.price));
          maxPrice = Math.max(...offers.map(o => o.price));

          const otherOffers = offers.filter(o => o.supplier_id !== req.userId);
          supplierCountOthers = otherOffers.length;
          if (supplierCountOthers > 0) {
            const sumOthers = otherOffers.reduce((sum, o) => sum + o.price, 0);
            avgPriceOthers = sumOthers / supplierCountOthers;
          }

          recommendedPrice = supplierCountOthers > 0 ? avgPriceOthers : avgPriceAll;
        }
      }
    }

    return res.json({
      status: 'success',
      found: !!product,
      product: product
        ? { id: product.id, name: product.name, category: product.category, unit: product.unit }
        : null,
      unit: product?.unit || null
      ,
      // Price recommendation (average across suppliers for this product)
      recommendedPrice: recommendedPrice,
      priceStats: {
        avgPriceAll,
        avgPriceOthers,
        supplierCountAll,
        supplierCountOthers,
        minPrice,
        maxPrice
      }
    });
  } catch (error) {
    console.error('Product lookup error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get all categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('name, display_name, default_specifications')
      .eq('is_active', true)
      .order('name', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    // Transform to match expected format
    const formattedCategories = (categories || []).map(cat => ({
      name: cat.name,
      displayName: cat.display_name,
      defaultSpecifications: cat.default_specifications || {}
    }));
    
    res.json({ 
      status: 'success',
      categories: formattedCategories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get default specifications for a given category
router.get('/categories/:name/specifications', authenticateToken, async (req, res) => {
  try {
    const rawName = req.params.name || '';
    const categoryName = rawName.trim().toLowerCase();
    const modelRaw = String(
      req.query.model || req.query.mpn || req.query.brandModel || ''
    ).trim();
    const modelIdentifier = normalizeModelIdentifier(modelRaw);

    console.log(`🔍 [GET SPECS] Request for category: "${rawName}" -> normalized: "${categoryName}"`);

    if (!categoryName) {
      return res.status(400).json({
        status: 'error',
        message: 'Category name is required'
      });
    }

    // Find category - try exact match first
    let { data: category, error } = await supabase
      .from('categories')
      .select('name, display_name, default_specifications')
      .eq('name', categoryName)
      .single();

    // If not found, try case-insensitive search
    if (error || !category) {
      const { data: allCategories } = await supabase
        .from('categories')
        .select('name, display_name, default_specifications')
        .eq('is_active', true);
      
      category = (allCategories || []).find(cat => cat.name.toLowerCase() === categoryName);
      
      if (!category) {
        console.log(`❌ [GET SPECS] Category "${categoryName}" not found`);
        return res.status(404).json({
          status: 'error',
          message: 'Category not found'
        });
      }
    }

    console.log(`✅ [GET SPECS] Category "${categoryName}" found`);

    // Ensure we return an empty object if defaultSpecifications is null/undefined
    let specs = {};
    let source = 'category';
    let modelProfile = null;

    // If model is provided and we've previously saved specs for that model+category,
    // use those as the primary template for all suppliers.
    if (modelIdentifier) {
      const { data: profile, error: profileError } = await supabase
        .from('model_spec_profiles')
        .select('model_identifier, display_model, specifications, updated_at')
        .eq('category', categoryName)
        .eq('model_identifier', modelIdentifier)
        .maybeSingle();
      if (profileError) {
        console.error('❌ [GET SPECS] Model profile fetch error:', profileError);
      } else if (profile && profile.specifications && typeof profile.specifications === 'object' && !Array.isArray(profile.specifications)) {
        const profileKeys = Object.keys(profile.specifications);
        if (profileKeys.length > 0) {
          specs = profile.specifications;
          source = 'model_profile';
          modelProfile = {
            modelIdentifier: profile.model_identifier,
            displayModel: profile.display_model,
            updatedAt: profile.updated_at
          };
        }
      }
    }

    // Backward-compat fallback: if model profile is missing, try approved catalog product
    // with the same category + name/model text and use its specifications.
    if (Object.keys(specs).length === 0 && modelIdentifier) {
      const { data: productMatch, error: productMatchError } = await supabase
        .from('products')
        .select('name, specifications, updated_at')
        .eq('category', categoryName)
        .eq('status', 'approved')
        .ilike('name', modelIdentifier)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (productMatchError) {
        console.error('❌ [GET SPECS] Product fallback fetch error:', productMatchError);
      } else if (
        productMatch &&
        productMatch.specifications &&
        typeof productMatch.specifications === 'object' &&
        !Array.isArray(productMatch.specifications) &&
        Object.keys(productMatch.specifications).length > 0
      ) {
        specs = productMatch.specifications;
        source = 'approved_product';
      }
    }

    // Fallback to admin category defaults when no model-specific profile exists.
    if (Object.keys(specs).length === 0) {
    if (category.default_specifications && 
        typeof category.default_specifications === 'object' && 
        !Array.isArray(category.default_specifications)) {
      const specKeys = Object.keys(category.default_specifications);
      if (specKeys.length > 0) {
        specs = category.default_specifications;
          source = 'category';
      }
    }
    }

    return res.json({
      status: 'success',
      category: {
        name: category.name,
        displayName: category.display_name || category.name
      },
      source,
      model: modelProfile,
      specifications: specs
    });
  } catch (error) {
    console.error('❌ [GET SPECS] Get category specifications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Create or get category
router.post('/categories', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierCategoryCreateSchema, req.body || {});
    const { name, displayName } = payloadInput;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Category name is required'
      });
    }
    
    const categoryName = name.trim().toLowerCase();
    
    // Check if category already exists
    let { data: category, error: fetchError } = await supabase
      .from('categories')
      .select('*')
      .eq('name', categoryName)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
      throw fetchError;
    }
    
    if (!category) {
      // Create new category
      const { data: newCategory, error: createError } = await supabase
        .from('categories')
        .insert({
        name: categoryName,
          display_name: displayName || name.trim(),
          created_by: req.userId,
          is_active: true
        })
        .select()
        .single();
      
      if (createError) {
        throw createError;
      }
      
      category = newCategory;
    } else if (!category.is_active) {
      // Reactivate if it was deactivated
      const { data: updatedCategory, error: updateError } = await supabase
        .from('categories')
        .update({ is_active: true })
        .eq('id', category.id)
        .select()
        .single();
      
      if (updateError) {
        throw updateError;
      }
      
      category = updatedCategory;
    }
    
    res.json({ 
      status: 'success',
      message: 'Category processed successfully',
      category 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create category error:', error);
    
    if (error.code === '23505') { // Unique violation
      const { data: existingCategory } = await supabase
        .from('categories')
        .select('*')
        .eq('name', String(req.body?.name || '').trim().toLowerCase())
        .single();
      
      return res.json({ 
        status: 'success',
        message: 'Category already exists',
        category: existingCategory
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get all units
router.get('/units', authenticateToken, async (req, res) => {
  try {
    const { data: units, error } = await supabase
      .from('units')
      .select('name, display_name')
      .eq('is_active', true)
      .order('name', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    // Transform to match expected format
    const formattedUnits = (units || []).map(unit => ({
      name: unit.name,
      displayName: unit.display_name
    }));
    
    res.json({ 
      status: 'success',
      units: formattedUnits
    });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Create or get unit
router.post('/units', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierUnitCreateSchema, req.body || {});
    const { name, displayName } = payloadInput;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Unit name is required'
      });
    }
    
    const unitName = name.trim().toLowerCase();
    
    // Check if unit already exists
    let { data: unit, error: fetchError } = await supabase
      .from('units')
      .select('*')
      .eq('name', unitName)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    if (!unit) {
      // Create new unit
      const { data: newUnit, error: createError } = await supabase
        .from('units')
        .insert({
        name: unitName,
          display_name: displayName || name.trim(),
          created_by: req.userId,
          is_active: true
        })
        .select()
        .single();
      
      if (createError) {
        throw createError;
      }
      
      unit = newUnit;
    } else if (!unit.is_active) {
      // Reactivate if it was deactivated
      const { data: updatedUnit, error: updateError } = await supabase
        .from('units')
        .update({ is_active: true })
        .eq('id', unit.id)
        .select()
        .single();
      
      if (updateError) {
        throw updateError;
      }
      
      unit = updatedUnit;
    }
    
    res.json({ 
      status: 'success',
      message: 'Unit processed successfully',
      unit 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Create unit error:', error);
    
    if (error.code === '23505') { // Unique violation
      const { data: existingUnit } = await supabase
        .from('units')
        .select('*')
        .eq('name', String(req.body?.name || '').trim().toLowerCase())
        .single();
      
      return res.json({ 
        status: 'success',
        message: 'Unit already exists',
        unit: existingUnit
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Add new product
router.post('/products', authenticateToken, async (req, res) => {
  try {
    req.body = parseWithSchema(supplierProductCreateSchema, req.body || {});
    const { category, unit, outlet_id, brandModel, lsa, hsnCode, catalogProductId, ...otherData } = req.body;
    const requestSpecs =
      otherData.specifications && typeof otherData.specifications === 'object' && !Array.isArray(otherData.specifications)
        ? { ...otherData.specifications }
        : {};
    const posLookupGsku = String(otherData.gsku || otherData.pos_lookup_code || '').trim();
    if (posLookupGsku) requestSpecs.gsku = posLookupGsku;
    const explicitBarcode = String(otherData.barcode || '').trim();
    const normalizedImageUrls = sanitizeImageUrls(otherData.images);
    const brandInput = String(
      otherData.brand || requestSpecs?.brand || brandModel || ''
    ).trim();
    const mpnInput = '';
    const gtinInput = normalizeGtin(
      otherData.gtin || requestSpecs?.gtin || requestSpecs?.upc || requestSpecs?.ean || ''
    );

    if (gtinInput && !isValidGtin(gtinInput)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.'
      });
    }

    // POS "GSKU" mode matches products.barcode, specifications.gsku, or products.gtin
    const resolvedBarcodeForPos = (explicitBarcode || gtinInput || posLookupGsku || '').trim() || null;

    // If the supplier provided a strong identifier (GTIN/barcode/GSKU), try to resolve an existing
    // APPROVED catalog product early. This makes approvals global: once any supplier's product is approved,
    // other suppliers can add offers immediately without creating new pending brand/product approvals.
    let canonicalProductFromIdentifier = null;
    if (gtinInput) {
      const { data: byGtin } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, specifications')
        .eq('gtin', gtinInput)
        .maybeSingle();
      if (byGtin) canonicalProductFromIdentifier = byGtin;
    }
    if (!canonicalProductFromIdentifier && resolvedBarcodeForPos) {
      const { data: byBarcode } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, specifications')
        .eq('barcode', resolvedBarcodeForPos)
        .maybeSingle();
      if (byBarcode) canonicalProductFromIdentifier = byBarcode;
    }

    // If we found a canonical product by identifier, treat its brand as the source of truth.
    // This prevents "new supplier typed slightly different brand" from creating a new pending brand.
    const effectiveBrandInput =
      canonicalProductFromIdentifier?.brand && String(canonicalProductFromIdentifier.brand).trim()
        ? String(canonicalProductFromIdentifier.brand).trim()
        : brandInput;

    // Brand lock: if supplier declared brands in profile, allow only those brands
    const brandGuard = brandIsAllowedForSupplier(req.user?.profile, effectiveBrandInput);
    if (!brandGuard.allowed) {
      return res.status(403).json({
        status: 'error',
        message:
          brandGuard.reason === 'brand_required'
            ? 'Brand is required because you have selected brands in your profile. Please enter a brand that matches your profile.'
            : 'You can only add products for brands you selected in your profile.',
        allowedBrands: brandGuard.declared || []
      });
    }

    // Brand approval gate: brand must be admin-approved BEFORE any product can be submitted.
    const brandApproval = await ensureBrandApprovedOrRequest({
      supabase,
      brandName: effectiveBrandInput,
      requesterUserId: req.userId
    });

    if (!brandApproval.ok) {
      return res.status(403).json({
        status: 'error',
        code: brandApproval.code,
        message: brandApproval.message,
        brand: brandApproval.brand
          ? {
              id: brandApproval.brand.id,
              name: brandApproval.brand.name,
              status: brandApproval.brand.status,
              rejection_reason: brandApproval.brand.rejection_reason || null
            }
          : null
      });
    }

    const taxValidation = await resolveTaxRatesForProductCreate({
      input: otherData,
      preferredProductId: String(catalogProductId || '').trim() || canonicalProductFromIdentifier?.id || null,
      categoryName: category
    });
    if (!taxValidation.ok) {
      return res.status(400).json({
        status: 'error',
        message: taxValidation.message
      });
    }
    const { igstRate, cgstRate, sgstRate } = taxValidation.data;
    
    // Ensure category exists (create if it doesn't)
    let categoryName = category?.trim().toLowerCase();
    if (categoryName) {
      let { data: categoryDoc } = await supabase
        .from('categories')
        .select('*')
        .eq('name', categoryName)
        .single();
      
      if (!categoryDoc) {
        const { data: newCategory } = await supabase
          .from('categories')
          .insert({
          name: categoryName,
            display_name: category.trim(),
            created_by: req.userId
          })
          .select()
          .single();
        categoryDoc = newCategory;
      }
    }
    
    // Ensure unit exists (create if it doesn't)
    let unitName = unit?.trim().toLowerCase();
    if (unitName) {
      let { data: unitDoc } = await supabase
        .from('units')
        .select('*')
        .eq('name', unitName)
        .single();
      
      if (!unitDoc) {
        const { data: newUnit } = await supabase
          .from('units')
          .insert({
          name: unitName,
            display_name: unit.trim(),
            created_by: req.userId
          })
          .select()
          .single();
        unitDoc = newUnit;
      }
    }
    
    // Normalize specifications for comparison (sort keys and stringify)
    let normalizedSpecs = requestSpecs;
    const specsString = JSON.stringify(
      Object.keys(normalizedSpecs)
        .sort()
        .reduce((obj, key) => {
          obj[key] = normalizedSpecs[key];
          return obj;
        }, {})
    );
    
    // Build Amazon-style identity bundle once and reuse it.
    const productNameRaw = otherData.name?.trim() || '';
    const productName = productNameRaw.toLowerCase();
    let identityBundle = buildIdentityBundle({
      name: otherData.name,
      category,
      brand: effectiveBrandInput,
      gtin: gtinInput,
      mpn: mpnInput,
      unit,
      brandModel,
      sku: requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '',
      packSize: requestSpecs?.packSize || requestSpecs?.pack_size || '',
      specifications: normalizedSpecs
    });

    // Guardrail: allow only admin-defined specification keys for this category when template exists.
    if (isCatalogGuardrailsEnabled()) {
      const { template, fields } = await loadSpecTemplateForCategory(categoryName || category, null);
      if (template && Array.isArray(fields) && fields.length > 0) {
        const validation = validateSpecValues(fields, normalizedSpecs);
        if (validation.errors.length > 0) {
          return res.status(400).json({
            status: 'error',
            message: 'Specification validation failed',
            errors: validation.errors
          });
        }
        normalizedSpecs = validation.allowed;
        identityBundle = buildIdentityBundle({
          name: otherData.name,
          category,
          brand: effectiveBrandInput,
          gtin: gtinInput,
          mpn: mpnInput,
          unit,
          brandModel,
          sku: requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '',
          packSize: requestSpecs?.packSize || requestSpecs?.pack_size || '',
          specifications: normalizedSpecs
        });
      }
    }

    // Spec guardrails drop unknown keys; always keep POS lookup code on the catalog row
    if (posLookupGsku) {
      normalizedSpecs = { ...normalizedSpecs, gsku: posLookupGsku };
    }
    
    // Amazon-style catalog matching priority:
    // 1) GTIN exact
    // 2) Brand + MPN exact
    // 3) catalog_key fallback
    // 4) legacy name+category compatibility
    let existingProduct = null;

    // If frontend selected an existing product from search suggestions, honor that directly.
    const selectedCatalogProductId = String(catalogProductId || '').trim();
    if (selectedCatalogProductId) {
      const { data: bySelectedId } = await supabase
        .from('products')
        .select('id, status, brand, gtin, barcode, name, category, asin, catalog_key, specifications')
        .eq('id', selectedCatalogProductId)
        .maybeSingle();
      if (bySelectedId) {
        existingProduct = bySelectedId;
      }
    }

    // If identifier already resolved a canonical product, use it as the top-priority match.
    // This is the strongest "same product" signal and supports global approvals.
    if (!existingProduct && canonicalProductFromIdentifier) {
      existingProduct = canonicalProductFromIdentifier;
      console.log(`✅ Found existing product by identifier lookup:`, {
        id: existingProduct.id,
        status: existingProduct.status,
        brand: existingProduct.brand,
        gtin: existingProduct.gtin,
        barcode: existingProduct.barcode
      });
    }
    if (!existingProduct && identityBundle.catalog.gtin) {
      const { data: byGtin } = await supabase
        .from('products')
        .select('*')
        .eq('gtin', identityBundle.catalog.gtin)
        .maybeSingle();
      if (byGtin) {
        existingProduct = byGtin;
        console.log(`✅ Found existing product by GTIN: ${identityBundle.catalog.gtin}`);
      }
    }

    if (!existingProduct && identityBundle.catalog.brand && identityBundle.catalog.mpn) {
      const { data: byBrandMpn } = await supabase
        .from('products')
        .select('*')
        .eq('brand', identityBundle.catalog.brand)
        .eq('mpn', identityBundle.catalog.mpn)
        .maybeSingle();
      if (byBrandMpn) {
        existingProduct = byBrandMpn;
        console.log(`✅ Found existing product by brand+MPN`);
      }
    }

    if (!existingProduct && identityBundle.catalogKey) {
      const { data: byCatalogKey } = await supabase
        .from('products')
        .select('*')
        .eq('catalog_key', identityBundle.catalogKey)
        .maybeSingle();
      if (byCatalogKey) {
        existingProduct = byCatalogKey;
        console.log(`✅ Found existing product by catalog_key`);
      }
    }

    if (!existingProduct && productName && categoryName) {
      // Legacy fallback for old rows without identity columns.
      const { data: productsByName, error: nameSearchError } = await supabase
        .from('products')
        .select('*')
        .eq('category', categoryName)
        .ilike('name', productNameRaw);

      if (!nameSearchError && productsByName && productsByName.length > 0) {
        // If multiple matches, prefer exact match, otherwise take first
        const exactMatch = productsByName.find(p => 
          normalizeText(p.name) === normalizeText(productNameRaw)
        );
        existingProduct = exactMatch || productsByName[0];
        console.log(`✅ Found existing product by name+category:`, {
          id: existingProduct.id,
          name: existingProduct.name,
          category: existingProduct.category,
          status: existingProduct.status
        });
      } else {
        // If no exact match, try normalized comparison for all products in category
        const { data: allCategoryProducts, error: categoryError } = await supabase
          .from('products')
          .select('*')
          .eq('category', categoryName);
        
        if (!categoryError && allCategoryProducts && allCategoryProducts.length > 0) {
          const normalizedInputName = normalizeText(productNameRaw);
          const match = allCategoryProducts.find(p => {
            const normalizedProductName = normalizeText(p.name);
            return normalizedProductName === normalizedInputName;
          });
          
          if (match) {
            existingProduct = match;
            console.log(`✅ Found existing product by normalized name+category:`, {
              id: existingProduct.id,
              name: existingProduct.name,
              category: existingProduct.category,
              status: existingProduct.status
            });
          }
        }
      }
    }
    
    let productId;
    let catalogAsin;
    let isNewProduct = false;
    
    // If existing product found, use its ID (same product ID for same product)
    if (existingProduct) {
      productId = existingProduct.id;
      catalogAsin = existingProduct.asin || identityBundle.asinLikeId;
      console.log(`🔄 Product already exists with ID: ${productId}. Adding supplier-specific data.`);

      // Backward-compatibility: older/shared products may have `supplier_id` null.
      // Admin UI expects `products.supplier_id` to show who submitted the product,
      // so fill it only if it's currently missing.
      if (!existingProduct.supplier_id) {
        try {
          await supabase
            .from('products')
            .update({ supplier_id: req.userId })
            .eq('id', productId)
            .is('supplier_id', null);
        } catch (e) {
          // Don't block adding supplier_products if this update fails.
          console.log('⚠️ Failed to backfill products.supplier_id:', e?.message || e);
        }
      }

      // Backfill identity columns for legacy products where possible.
      try {
        const patch = {};
        if (!existingProduct.asin) patch.asin = identityBundle.asinLikeId;
        if (!existingProduct.gtin && identityBundle.catalog.gtin) patch.gtin = identityBundle.catalog.gtin;
        if (!existingProduct.mpn && identityBundle.catalog.mpn) patch.mpn = identityBundle.catalog.mpn;
        if (!existingProduct.brand && identityBundle.catalog.brand) patch.brand = identityBundle.catalog.brand;
        if (!existingProduct.catalog_key) patch.catalog_key = identityBundle.catalogKey;
        if (!existingProduct.barcode && resolvedBarcodeForPos) patch.barcode = resolvedBarcodeForPos;

        if (Object.keys(patch).length > 0) {
          await supabase.from('products').update(patch).eq('id', productId);
        }
      } catch (e) {
        console.log('⚠️ Failed to backfill product identity columns:', e?.message || e);
      }
    } else {
      // Create new product with shared data only.
      // NOTE: The products table still has NOT NULL constraints on price, stock and location,
      // so we also populate those fields from the first supplier's data to satisfy the constraint.
      const basePrice = otherData.price !== undefined ? parseFloat(otherData.price) : 0;
      const baseStock = otherData.stock !== undefined ? parseInt(otherData.stock) : 0;
      const baseMinOrderQty = otherData.min_order_quantity !== undefined
        ? parseInt(otherData.min_order_quantity)
        : 1;
      const baseLocation = (otherData.location || '').trim() || 'Not specified';
    
    const productData = {
        name: otherData.name,
        description: otherData.description || '',
      category: categoryName,
      unit: unitName,
        images: normalizedImageUrls,
        specifications: normalizedSpecs,
        // Used by admin UI / legacy joins. Authoritative values for offers live in `supplier_products`.
        supplier_id: req.userId,
        // These fields are primarily used for backward compatibility; the authoritative
        // supplier-specific values now live in supplier_products.
        price: isNaN(basePrice) ? 0 : basePrice,
        stock: isNaN(baseStock) ? 0 : baseStock,
        min_order_quantity: isNaN(baseMinOrderQty) || baseMinOrderQty < 1 ? 1 : baseMinOrderQty,
        location: baseLocation
      };
      
      console.log(`📦 Creating new product with shared data`);

      // Persist Amazon-style identity signals.
      productData.asin = identityBundle.asinLikeId;
      productData.gtin = identityBundle.catalog.gtin || null;
      productData.mpn = identityBundle.catalog.mpn || null;
      productData.brand = identityBundle.catalog.brand || null;
      productData.catalog_key = identityBundle.catalogKey;
      if (resolvedBarcodeForPos) productData.barcode = resolvedBarcodeForPos;
    
    const { data: newProduct, error: createError } = await supabase
      .from('products')
      .insert(productData)
      .select()
      .single();
    
    if (createError) {
      console.error('Product creation error:', createError);
      return res.status(400).json({
        status: 'error',
        message: createError.message || 'Error creating product'
      });
    }
    
      productId = newProduct.id;
      catalogAsin = newProduct.asin || identityBundle.asinLikeId;
      isNewProduct = true;
    console.log(`✅ Product created successfully:`, {
      id: newProduct.id,
        name: newProduct.name
      });
    }
    
    // Check if exact supplier variant already exists for this supplier/product/location.
    const currentLocation = (otherData.location || '').trim();
    const { data: existingSupplierProduct } = await supabase
      .from('supplier_products')
      .select('*')
      .eq('product_id', productId)
      .eq('supplier_id', req.userId)
      .eq('location', currentLocation)
      .eq('variant_key', identityBundle.variantKey)
      .maybeSingle();
    
    if (existingSupplierProduct) {
      return res.status(400).json({
        status: 'error',
        message: 'You have already added this exact product variation for this location. Please update the existing entry instead.'
      });
    }
    
    // Create supplier_products entry with supplier-specific data
    // IMPORTANT: If this is a brand new product (first supplier to add it), 
    // the supplier entry should be pending admin approval.
    // If the product already exists (other suppliers have it, regardless of their status),
    // auto-approve this supplier's entry since the product is already in the system.
    const parsedPrice = parseFloat(otherData.price);
    const parsedStock = parseInt(otherData.stock);
    const parsedMinOrderQty = parseInt(otherData.min_order_quantity);

    // Approval rule:
    // - Auto-approve only when this exact variant_key is already approved in the catalog offers.
    // - If specs differ (new variant_key), keep pending for admin review even if base product is approved.
    const { data: approvedVariantOffer } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', productId)
      .eq('variant_key', identityBundle.variantKey)
      .eq('status', 'approved')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const selectedCatalogSpecs =
      existingProduct?.specifications &&
      typeof existingProduct.specifications === 'object' &&
      !Array.isArray(existingProduct.specifications)
        ? existingProduct.specifications
        : {};
    const selectedCatalogIsApproved = String(existingProduct?.status || '').toLowerCase() === 'approved';
    const selectedProductSpecsChanged = !!selectedCatalogProductId && shouldMoveToPendingForSpecChange({
      specificationsProvided: true,
      currentSpecs: selectedCatalogSpecs,
      nextSpecs: normalizedSpecs
    });
    const shouldBeApproved = Boolean(
      approvedVariantOffer ||
      (selectedCatalogProductId && selectedCatalogIsApproved && !selectedProductSpecsChanged)
    );
    const variantAsin = buildVariantAsinLikeId(catalogAsin || identityBundle.asinLikeId, identityBundle.variantKey);

    const supplierProductData = {
      product_id: productId,
      supplier_id: req.userId,
      price: isNaN(parsedPrice) ? 0 : parsedPrice,
      stock: isNaN(parsedStock) ? 0 : parsedStock,
      min_order_quantity: isNaN(parsedMinOrderQty) || parsedMinOrderQty < 1 ? 1 : parsedMinOrderQty,
      location: currentLocation,
      outlet_id: outlet_id || null,
      // Approved only if the shared product is approved by admin.
      status: shouldBeApproved ? 'approved' : 'pending',
      is_active: shouldBeApproved ? true : false,
      igst_rate: igstRate,
      cgst_rate: cgstRate,
      sgst_rate: sgstRate,
      variant_key: identityBundle.variantKey,
      variant_asin: variantAsin,
      // Store supplier-specific extended data so we always keep their version
      // of the product, even if the shared products row is the same.
      attributes: {
        // Supplier-specific description (can differ from base product)
        description: otherData.description || '',
        // Supplier-specific specifications (if they provided their own)
        specifications: otherData.specifications || normalizedSpecs,
        // Raw name/category they sent (for audit)
        name: otherData.name,
        category: category,
        // Supplier-provided combined brand/model string (e.g., "ACC OPC 53 - 50kg")
        brandModel: (brandModel || '').toString().trim(),
        // Canonical brand + manufacturer part number used for catalog matching.
        brand: effectiveBrandInput,
        mpn: mpnInput,
        gtin: gtinInput,
        // Supplier-provided LSA code/value for inventory tracking
        lsa: (lsa || '').toString().trim(),
        // Supplier-provided HSN code for exact GST determination
        hsnCode: (hsnCode || '').toString().trim(),
        // Optional identifiers used to compute variation identity.
        sku: (requestSpecs?.skuNo || requestSpecs?.sku || requestSpecs?.gsku || '').toString().trim(),
        packSize: (requestSpecs?.packSize || requestSpecs?.pack_size || '').toString().trim(),
        unit: (unit || '').toString().trim(),
        // Admin-defined category specification values used for variation uniqueness.
        variantAttributes: identityBundle.variant.variantAttributes,
        // Any extra fields we might care about later can be added here
        igstRate,
        cgstRate,
        sgstRate,
        tags: otherData.tags || [],
        images: normalizedImageUrls
      }
    };
    
    console.log(`📦 Creating supplier_products entry for product: ${productId}, supplier: ${req.userId}`);

    const { data: newSupplierProduct, error: supplierProductError } = await supabase
      .from('supplier_products')
      .insert(supplierProductData)
      .select()
      .single();
    
    if (supplierProductError) {
      console.error('Supplier product creation error:', supplierProductError);
      
      // Check if error is due to unique constraint violation (supplier already has this product)
      if (supplierProductError.code === '23505' || supplierProductError.message?.includes('duplicate') || supplierProductError.message?.includes('unique')) {
        return res.status(400).json({
          status: 'error',
          message: 'This exact product variation already exists for the same location. Please update the existing entry instead.'
        });
      }
      
      // If this was a new product, we might want to clean it up, but for now just return error
      return res.status(400).json({
        status: 'error',
        message: supplierProductError.message || 'Error creating supplier product entry'
      });
    }
    
    console.log(`✅ Supplier product entry created successfully:`, {
      id: newSupplierProduct.id,
      productId: newSupplierProduct.product_id,
      supplierId: newSupplierProduct.supplier_id,
      price: newSupplierProduct.price,
      status: newSupplierProduct.status
    });

    // Guardrails path: upsert canonical family/variant refs and queue uncertain rows for review.
    if (isCatalogGuardrailsEnabled()) {
      try {
        const familyKeySeed = `${identityBundle.catalog.brand || ''}|${identityBundle.catalog.category || categoryName || ''}|${identityBundle.catalog.name || productNameRaw || ''}`.toLowerCase().trim();
        const familyKey = familyKeySeed ? crypto.createHash('sha256').update(familyKeySeed).digest('hex') : null;
        let familyId = existingProduct?.family_id || null;

        if (!familyId && familyKey) {
          const { data: existingFamily } = await supabase
            .from('product_families')
            .select('id')
            .eq('normalized_family_key', familyKey)
            .maybeSingle();
          if (existingFamily?.id) {
            familyId = existingFamily.id;
          } else {
            const { data: createdFamily } = await supabase
              .from('product_families')
              .insert({
                canonical_name: otherData.name || 'Unnamed Product',
                brand: identityBundle.catalog.brand || null,
                category: categoryName || 'uncategorized',
                model_line: (brandModel || '').toString().trim() || null,
                normalized_family_key: familyKey,
                status: 'active',
                created_by: req.userId
              })
              .select('id')
              .single();
            familyId = createdFamily?.id || null;
          }
        }

        let productVariantId = null;
        if (familyId) {
          const { data: existingVariant } = await supabase
            .from('product_variants')
            .select('id')
            .eq('family_id', familyId)
            .eq('variant_key', identityBundle.variantKey)
            .maybeSingle();

          if (existingVariant?.id) {
            productVariantId = existingVariant.id;
          } else {
            const { data: createdVariant } = await supabase
              .from('product_variants')
              .insert({
                family_id: familyId,
                product_id: productId,
                variant_name: otherData.name || null,
                variant_key: identityBundle.variantKey,
                variant_asin: variantAsin,
                gtin: identityBundle.catalog.gtin || null,
                mpn: identityBundle.catalog.mpn || null,
                brand: identityBundle.catalog.brand || null,
                unit: unitName || null,
                pack_size: requestSpecs?.packSize || requestSpecs?.pack_size || null,
                canonical_attributes: identityBundle.variant.variantAttributes || {},
                status: shouldBeApproved ? 'approved' : 'review_pending',
                created_by: req.userId
              })
              .select('id')
              .single();
            productVariantId = createdVariant?.id || null;
          }
        }

        if (familyId) {
          await supabase
            .from('products')
            .update({ family_id: familyId, variant_id: productVariantId || null })
            .eq('id', productId);
        }
        if (productVariantId) {
          await supabase
            .from('supplier_products')
            .update({ product_variant_id: productVariantId, price_updated_at: new Date().toISOString() })
            .eq('id', newSupplierProduct.id);
        }

        const { template, fields } = await loadSpecTemplateForCategory(categoryName, familyId);
        const specValidation = fields.length > 0
          ? validateSpecValues(fields, otherData.specifications || requestSpecs || {})
          : { allowed: (otherData.specifications || requestSpecs || {}), errors: [], unknownKeys: [] };
        const confidenceScore = scoreOnboardingConfidence({
          identityBundle,
          validationErrors: specValidation.errors,
          unknownKeys: specValidation.unknownKeys
        });
        const finalDecision = decideOnboardingAction(confidenceScore, onboardingAutoApproveThreshold);

        let requestId = null;
        if (finalDecision !== 'auto_linked') {
          const { data: createdRequest } = await supabase
            .from('product_requests')
            .insert({
              requested_by: req.userId,
              supplier_id: req.userId,
              source: 'supplier',
              status: 'new',
              category: categoryName || null,
              normalized_input: {
                name: otherData.name || '',
                category: categoryName,
                identityBundle
              },
              ai_prefill: {
                templateId: template?.id || null,
                values: specValidation.allowed
              },
              confidence_score: confidenceScore,
              resolved_product_id: productId,
              resolved_variant_id: productVariantId
            })
            .select('id')
            .single();
          requestId = createdRequest?.id || null;
        }

        await supabase
          .from('product_ingestion_runs')
          .insert({
            request_id: requestId,
            supplier_id: req.userId,
            provider: 'manual',
            model: 'supplier_portal',
            prompt_version: 'v1',
            input_payload: {
              body: req.body,
              templateId: template?.id || null
            },
            extracted_payload: otherData.specifications || requestSpecs || {},
            validated_payload: specValidation.allowed || {},
            confidence_score: confidenceScore,
            validation_errors: specValidation.errors || [],
            final_decision: finalDecision,
            actor_id: req.userId
          });
      } catch (guardrailError) {
        console.log('⚠️ Guardrails metadata write failed:', guardrailError?.message || guardrailError);
      }
    }

    if (!isCatalogGuardrailsEnabled()) {
      // Backward compatibility mode: keep syncing legacy catalog commercial fields.
      try {
        await supabase
          .from('products')
          .update({
            price: newSupplierProduct.price,
            stock: newSupplierProduct.stock,
            min_order_quantity: newSupplierProduct.min_order_quantity,
            location: newSupplierProduct.location,
            supplier_id: req.userId
          })
          .eq('id', productId);
        console.log('✅ Synced legacy products.price/stock from supplier_products (create)');
      } catch (e) {
        console.log('⚠️ Failed to sync legacy products price/stock (create):', e?.message || e);
      }
    }

    // Persist model-level shared specification profile so other suppliers
    // see the same model keys/values next time they add this model.
    await upsertModelSpecProfile({
      category: categoryName || category,
      modelRaw: mpnInput || brandModel,
      specifications: normalizedSpecs,
      actorUserId: req.userId
    });
    
    // Fetch the complete product with supplier data for response
    const { data: completeProduct, error: fetchError } = await supabase
      .from('products')
      .select(`
        *,
        supplier_products!inner(*)
      `)
      .eq('id', productId)
      .eq('supplier_products.supplier_id', req.userId)
      .eq('supplier_products.location', currentLocation)
        .eq('supplier_products.variant_key', identityBundle.variantKey)
      .single();
    
    let responseProduct;

    if (fetchError) {
      // Fallback: fetch product and supplier_products separately
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();
      
      const { data: supplierProduct } = await supabase
        .from('supplier_products')
        .select('*')
        .eq('product_id', productId)
        .eq('supplier_id', req.userId)
        .eq('location', currentLocation)
        .eq('variant_key', identityBundle.variantKey)
        .maybeSingle();
      
      // Combine for response
      responseProduct = {
        ...product,
        price: supplierProduct?.price,
        stock: supplierProduct?.stock,
        igst_rate: supplierProduct?.igst_rate ?? supplierProduct?.attributes?.igstRate ?? null,
        cgst_rate: supplierProduct?.cgst_rate ?? supplierProduct?.attributes?.cgstRate ?? null,
        sgst_rate: supplierProduct?.sgst_rate ?? supplierProduct?.attributes?.sgstRate ?? null,
        location: supplierProduct?.location,
        min_order_quantity: supplierProduct?.min_order_quantity,
        status: supplierProduct?.status,
        is_active: supplierProduct?.is_active,
        supplier_id: req.userId,
        variantKey: supplierProduct?.variant_key || identityBundle.variantKey,
        variantAsin: supplierProduct?.variant_asin || variantAsin,
        brandModel: supplierProduct?.attributes?.brandModel,
        lsa: supplierProduct?.attributes?.lsa,
        hsnCode: supplierProduct?.attributes?.hsnCode,
        images:
          sanitizeImageUrls(supplierProduct?.attributes?.images).length > 0
            ? sanitizeImageUrls(supplierProduct?.attributes?.images)
            : sanitizeImageUrls(product?.images)
      };
      
      console.log(`✅ Product and supplier data combined successfully`);
    } else {
      // If we got completeProduct from join query, use that
      responseProduct = {
        ...completeProduct,
        price: completeProduct.supplier_products[0]?.price,
        stock: completeProduct.supplier_products[0]?.stock,
        igst_rate:
          completeProduct.supplier_products[0]?.igst_rate ??
          completeProduct.supplier_products[0]?.attributes?.igstRate ??
          null,
        cgst_rate:
          completeProduct.supplier_products[0]?.cgst_rate ??
          completeProduct.supplier_products[0]?.attributes?.cgstRate ??
          null,
        sgst_rate:
          completeProduct.supplier_products[0]?.sgst_rate ??
          completeProduct.supplier_products[0]?.attributes?.sgstRate ??
          null,
        location: completeProduct.supplier_products[0]?.location,
        min_order_quantity: completeProduct.supplier_products[0]?.min_order_quantity,
        status: completeProduct.supplier_products[0]?.status,
        is_active: completeProduct.supplier_products[0]?.is_active,
        supplier_id: req.userId,
        variantKey: completeProduct.supplier_products[0]?.variant_key || identityBundle.variantKey,
        variantAsin: completeProduct.supplier_products[0]?.variant_asin || variantAsin,
        brandModel: completeProduct.supplier_products[0]?.attributes?.brandModel,
        lsa: completeProduct.supplier_products[0]?.attributes?.lsa,
        hsnCode: completeProduct.supplier_products[0]?.attributes?.hsnCode,
        images:
          sanitizeImageUrls(completeProduct.supplier_products[0]?.attributes?.images).length > 0
            ? sanitizeImageUrls(completeProduct.supplier_products[0]?.attributes?.images)
            : sanitizeImageUrls(completeProduct?.images)
      };
    }

    // Get supplier info for notifications
    const { data: supplier } = await findUserBasicById(req.userId, supabase);

    // Notify admins for approvals when product/variant is pending review.
    if (!shouldBeApproved) {
      // Create notification for all admins
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);

      if (admins && admins.length > 0) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: 'product_approval',
          title: `Product/Variant Pending Approval: ${responseProduct.name}`,
          message: `${supplier?.name} (${supplier?.company || supplier?.email}) added "${responseProduct.name}" with variant specifications that require your approval.`,
          related_product_id: productId,
          related_supplier_id: supplier?.id || req.userId,
          metadata: {
            productName: responseProduct.name,
            productDescription: responseProduct.description,
            productCategory: responseProduct.category,
            productPrice: responseProduct.price,
            productUnit: responseProduct.unit,
            productStock: responseProduct.stock,
            productLocation: responseProduct.location,
            productMinOrderQuantity: responseProduct.min_order_quantity,
            productSpecifications: responseProduct.specifications,
            supplierName: supplier?.name,
            supplierEmail: supplier?.email,
            supplierCompany: supplier?.company,
            productId: productId,
            isExistingProduct: !isNewProduct,
            variantKey: identityBundle.variantKey
          },
          is_read: false
        }));

        if (notifications.length > 0) {
          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin approval notification(s) for pending product/variant`);
        }
      }
    } else {
      // Product already exists in the catalog; still notify admins that this supplier
      // added/updated an inventory offer for it (so admin can review latest stock/price).
      try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
        const { data: admins } = await findAdmins(adminEmail, supabase);

        if (admins && admins.length > 0) {
          const notifications = admins.map((admin) => ({
            user_id: admin.id,
            type: 'supplier_edit',
            title: `Supplier Updated Inventory: ${responseProduct.name}`,
            message: `${supplier?.name || 'Supplier'} added inventory for "${responseProduct.name}" (Price: ₹${
              responseProduct.price ?? 0
            }, Stock: ${responseProduct.stock ?? 0}, Location: ${
              responseProduct.location || 'N/A'
            }).`,
            related_product_id: productId,
            related_supplier_id: supplier?.id || req.userId,
            metadata: {
              productId,
              productName: responseProduct.name,
              supplierId: req.userId,
              supplierName: supplier?.name,
              price: responseProduct.price ?? 0,
              stock: responseProduct.stock ?? 0,
              location: responseProduct.location || null,
              minOrderQuantity: responseProduct.min_order_quantity ?? null,
              status: responseProduct.status ?? null
            },
            is_read: false
          }));

          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin notification(s) for supplier inventory offer (existing product)`);
        }
      } catch (notifErr) {
        console.log('⚠️ Failed to notify admins for supplier inventory offer:', notifErr?.message || notifErr);
      }
    }

    // If this product was originally requested by a service provider, notify them
    // that a supplier has now added it and it is available in the marketplace.
    if (!isNewProduct && responseProduct && responseProduct.requested_by_service_provider_id) {
      try {
        await insertNotification({
            user_id: responseProduct.requested_by_service_provider_id,
            type: 'system',
            title: `Supplier added your requested product: ${responseProduct.name}`,
            message: `${supplier?.name || 'A supplier'} (${supplier?.company || supplier?.email || ''}) has added the product "${responseProduct.name}". You can now use this product in your BOQs and purchase orders.`,
            related_product_id: productId,
            related_supplier_id: req.userId,
            metadata: {
              productId: productId,
              productName: responseProduct.name,
              productCategory: responseProduct.category,
              productUnit: responseProduct.unit,
              supplierId: req.userId,
              supplierName: supplier?.name,
              supplierCompany: supplier?.company,
              source: 'service_provider_request_fulfilled'
            }
          }, supabase);
        console.log(
          `Notified service provider ${responseProduct.requested_by_service_provider_id} that supplier ${req.userId} added requested product ${productId}`
        );
      } catch (spNotifError) {
        console.error(
          'Failed to create notification for service provider about requested product being added:',
          spNotifError
        );
      }
    }

    // Determine the appropriate success message
    let successMessage;
    if (!shouldBeApproved) {
      successMessage = 'Product added successfully and is pending admin approval for this variant.';
    } else {
      successMessage = 'Product added successfully and is immediately available.';
    }
    
    res.status(201).json({ 
      status: 'success',
      message: successMessage,
      product: responseProduct,
      nextStep: {
        type: 'bcov_setup',
        supplierProductId: responseProduct?.supplier_product_id || null,
        variantKey: responseProduct?.variantKey || null,
        variantAsin: responseProduct?.variantAsin || null,
        brand: String(
          responseProduct?.brandModel ||
          responseProduct?.brand ||
          responseProduct?.specifications?.brandModel ||
          responseProduct?.specifications?.brand ||
          ''
        ).trim(),
        productName: String(responseProduct?.name || '').trim()
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Add product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Update product (supports both shared product data and supplier-specific inventory)
router.put('/products/:id', authenticateToken, async (req, res) => {
  try {
    req.body = parseWithSchema(supplierProductUpdateSchema, req.body || {});
    const id = req.params.id;
    console.log(`[Supplier Inventory] PUT /api/supplier/products/${id} by supplier ${req.userId}`, {
      bodyKeys: Object.keys(req.body || {}),
      price: req.body?.price,
      stock: req.body?.stock,
      location: req.body?.location
    });

    // ============================
    // 1) Try to treat ID as supplier_products.id (inventory update)
    // ============================
    const { data: supplierProduct, error: supplierProductError } = await supabase
      .from('supplier_products')
      .select('*')
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .maybeSingle();

    if (supplierProduct) {
      console.log(`Updating supplier_products entry ${id} for supplier ${req.userId}:`, {
        location: req.body.location,
        price: req.body.price,
        stock: req.body.stock
      });

      // Build update object for supplier_products
      const parsedPrice = parseFloat(req.body.price);
      const parsedStock = parseInt(req.body.stock);
      const parsedMinOrderQty = parseInt(
        req.body.min_order_quantity !== undefined
          ? req.body.min_order_quantity
          : supplierProduct.min_order_quantity || 1
      );
      const taxFieldsProvided =
        req.body.igst_rate !== undefined ||
        req.body.igstRate !== undefined ||
        req.body.cgst_rate !== undefined ||
        req.body.cgstRate !== undefined ||
        req.body.sgst_rate !== undefined ||
        req.body.sgstRate !== undefined;

      const updateSupplierProductData = {};

      if (req.body.price !== undefined) {
        updateSupplierProductData.price = Number.isFinite(parsedPrice)
          ? parsedPrice
          : supplierProduct.price;
        updateSupplierProductData.price_updated_at = new Date().toISOString();
      }

      if (req.body.stock !== undefined) {
        updateSupplierProductData.stock =
          Number.isInteger(parsedStock) && parsedStock >= 0
            ? parsedStock
            : supplierProduct.stock;
      }

      if (req.body.location !== undefined) {
        const newLocation = (req.body.location || '').trim();
        updateSupplierProductData.location = newLocation || supplierProduct.location;
      }

      if (req.body.min_order_quantity !== undefined) {
        updateSupplierProductData.min_order_quantity =
          Number.isInteger(parsedMinOrderQty) && parsedMinOrderQty > 0
            ? parsedMinOrderQty
            : supplierProduct.min_order_quantity || 1;
      }

      if (taxFieldsProvided) {
        const taxValidation = validateAndNormalizeTaxRates(req.body);
        if (!taxValidation.ok) {
          return res.status(400).json({
            status: 'error',
            message: taxValidation.message
          });
        }
        updateSupplierProductData.igst_rate = taxValidation.data.igstRate;
        updateSupplierProductData.cgst_rate = taxValidation.data.cgstRate;
        updateSupplierProductData.sgst_rate = taxValidation.data.sgstRate;
      }

      // Update supplier-specific attributes (description, specifications)
      const existingAttributes = supplierProduct.attributes || {};
      const updatedAttributes = { ...existingAttributes };

      if (req.body.description !== undefined) {
        updatedAttributes.description = req.body.description;
      }

      // Variant-level listing fields (shared products row is the same for all variants)
      if (req.body.name !== undefined) {
        updatedAttributes.listingName = (req.body.name || '').toString().trim();
      }
      if (req.body.brand !== undefined) {
        updatedAttributes.brand = (req.body.brand || '').toString().trim();
      }
      if (req.body.gtin !== undefined) {
        const g = normalizeGtin(req.body.gtin || '');
        if (g && !isValidGtin(g)) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid GTIN. Use 8, 12, 13, or 14 digit numeric code.'
          });
        }
        updatedAttributes.gtin = g || null;
      }
      if (req.body.mpn !== undefined) {
        updatedAttributes.mpn = (req.body.mpn || '').toString().trim();
      }

      if (req.body.specifications !== undefined) {
        updatedAttributes.specifications =
          req.body.specifications || existingAttributes.specifications || {};
      }

      if (req.body.brandModel !== undefined) {
        updatedAttributes.brandModel = (req.body.brandModel || '').toString().trim();
      }

      if (req.body.lsa !== undefined) {
        updatedAttributes.lsa = (req.body.lsa || '').toString().trim();
      }
      if (req.body.hsnCode !== undefined || req.body.hsn_code !== undefined) {
        const rawHsnCode = req.body.hsnCode !== undefined ? req.body.hsnCode : req.body.hsn_code;
        updatedAttributes.hsnCode = (rawHsnCode || '').toString().trim();
      }
      if (req.body.sku !== undefined || req.body.skuNo !== undefined || req.body.gsku !== undefined) {
        updatedAttributes.sku = (
          req.body.skuNo !== undefined ? req.body.skuNo : req.body.sku !== undefined ? req.body.sku : req.body.gsku
        || '').toString().trim();
      }
      if (req.body.packSize !== undefined || req.body.pack_size !== undefined) {
        updatedAttributes.packSize = (
          req.body.packSize !== undefined ? req.body.packSize : req.body.pack_size
        || '').toString().trim();
      }
      if (req.body.unit !== undefined) {
        updatedAttributes.unit = (req.body.unit || '').toString().trim();
      }
      if (req.body.images !== undefined) {
        updatedAttributes.images = sanitizeImageUrls(req.body.images);
      }

      const nextSpecifications = req.body.specifications !== undefined
        ? (req.body.specifications || {})
        : (existingAttributes.specifications || {});
      updatedAttributes.variantAttributes = normalizeVariantAttributes(nextSpecifications);

      const specificationsChanged = shouldMoveToPendingForSpecChange({
        specificationsProvided: req.body.specifications !== undefined,
        currentSpecs: existingAttributes.specifications || {},
        nextSpecs: nextSpecifications || {}
      });

      if (Object.keys(updatedAttributes).length > 0) {
        if (taxFieldsProvided) {
          updatedAttributes.igstRate = updateSupplierProductData.igst_rate;
          updatedAttributes.cgstRate = updateSupplierProductData.cgst_rate;
          updatedAttributes.sgstRate = updateSupplierProductData.sgst_rate;
        }
        updateSupplierProductData.attributes = updatedAttributes;
      }

      // Brand lock on inventory updates: do not allow changing/setting brandModel outside declared brands
      if (req.body.brandModel !== undefined) {
        const nextBrand = updatedAttributes.brandModel;
        const brandGuard = brandIsAllowedForSupplier(req.user?.profile, nextBrand);
        if (!brandGuard.allowed) {
          return res.status(403).json({
            status: 'error',
            message:
              brandGuard.reason === 'brand_required'
                ? 'Brand is required because you have selected brands in your profile.'
                : 'You can only update inventory for brands you selected in your profile.',
            allowedBrands: brandGuard.declared || []
          });
        }
      }

      // Recompute variation identity for uniqueness checks.
      const candidateLocation = req.body.location !== undefined
        ? ((req.body.location || '').trim() || supplierProduct.location)
        : supplierProduct.location;
      const variantIdentity = buildIdentityBundle({
        unit: req.body.unit !== undefined ? req.body.unit : updatedAttributes.unit,
        brandModel: updatedAttributes.brandModel,
        sku: updatedAttributes.sku,
        packSize: updatedAttributes.packSize,
        specifications: nextSpecifications
      });
      updateSupplierProductData.variant_key = variantIdentity.variantKey;
      const { data: productIdentity } = await supabase
        .from('products')
        .select('asin')
        .eq('id', supplierProduct.product_id)
        .maybeSingle();
      updateSupplierProductData.variant_asin = buildVariantAsinLikeId(
        productIdentity?.asin || '',
        variantIdentity.variantKey
      );

      // Prevent duplicate exact variation rows when location/attributes change.
      const { data: duplicateVariant } = await supabase
        .from('supplier_products')
        .select('id')
        .eq('product_id', supplierProduct.product_id)
        .eq('supplier_id', req.userId)
        .eq('location', candidateLocation)
        .eq('variant_key', variantIdentity.variantKey)
        .neq('id', id)
        .maybeSingle();

      if (duplicateVariant) {
        return res.status(400).json({
          status: 'error',
          message: 'An identical product variation already exists for this location. Update that offer instead.'
        });
      }

      // Any supplier spec change must go back through admin approval workflow.
      // This enforces controlled variant changes even on previously approved offers.
      let movedToPendingForSpecReview = false;
      if (specificationsChanged) {
        movedToPendingForSpecReview = true;
        updateSupplierProductData.status = 'pending';
        updateSupplierProductData.is_active = false;
        updateSupplierProductData.approved_by = null;
        updateSupplierProductData.approved_at = null;
        updateSupplierProductData.rejection_reason = null;
      }

      // Only perform update if there's something to change
      if (Object.keys(updateSupplierProductData).length === 0) {
        return res.json({
          status: 'success',
          message: 'No changes detected',
          product: supplierProduct
        });
      }

      const { data: updatedSupplierProduct, error: spUpdateError } = await supabase
        .from('supplier_products')
        .update(updateSupplierProductData)
        .eq('id', id)
        .eq('supplier_id', req.userId)
        .select('*')
        .single();

      if (spUpdateError || !updatedSupplierProduct) {
        console.error('Supplier product update error:', spUpdateError);
        return res.status(400).json({
          status: 'error',
          message: spUpdateError?.code === '23505'
            ? 'This exact product variation already exists for the selected location.'
            : (spUpdateError?.message || 'Failed to update product')
        });
      }

      if (req.body.stock !== undefined) {
        const prevS = parseInt(supplierProduct.stock, 10) || 0;
        const newS = parseInt(updatedSupplierProduct.stock, 10) || 0;
        if (newS !== prevS) {
          void maybeNotifyInventoryBelowMov({
            supplierId: req.userId,
            supplierProductId: updatedSupplierProduct.id,
            previousStock: prevS,
            newStock: newS,
            quantityChange: newS - prevS
          });
        }
      }

      // Fetch shared product data to return a combined object
      const { data: baseProduct, error: baseProductError } = await supabase
        .from('products')
        .select('*')
        .eq('id', updatedSupplierProduct.product_id)
        .single();

      if (baseProductError || !baseProduct) {
        console.error('Failed to fetch base product for updated supplier product:', baseProductError);
      }

      await upsertModelSpecProfile({
        category: req.body.category || baseProduct?.category,
        modelRaw: req.body.mpn || updatedAttributes.brandModel || baseProduct?.mpn,
        specifications: nextSpecifications,
        actorUserId: req.userId
      });

    if (!isCatalogGuardrailsEnabled()) {
      // Legacy: mirror one offer onto products — only safe when this supplier has a single offer
      // for that catalog id (otherwise variants overwrite each other on the shared row).
      try {
        const { data: siblingOffers } = await supabase
          .from('supplier_products')
          .select('id')
          .eq('product_id', updatedSupplierProduct.product_id)
          .eq('supplier_id', req.userId)
          .neq('status', 'rejected');
        if ((siblingOffers || []).length <= 1) {
          await supabase
            .from('products')
            .update({
              price: updatedSupplierProduct.price,
              stock: updatedSupplierProduct.stock,
              min_order_quantity: updatedSupplierProduct.min_order_quantity,
              location: updatedSupplierProduct.location,
              supplier_id: updatedSupplierProduct.supplier_id || req.userId
            })
            .eq('id', updatedSupplierProduct.product_id);
          console.log('✅ Synced legacy products.price/stock from supplier_products update');
        }
      } catch (e) {
        console.log('⚠️ Failed to sync legacy products.price/stock:', e?.message || e);
      }
    }

      const ra = updatedSupplierProduct.attributes || {};
      const responseProduct = {
        ...(baseProduct || {}),
        name:
          (ra.listingName != null && String(ra.listingName).trim() !== '')
            ? String(ra.listingName).trim()
            : baseProduct?.name,
        description:
          ra.description !== undefined && ra.description !== null && String(ra.description) !== ''
            ? ra.description
            : baseProduct?.description ?? '',
        brand: ra.brand || baseProduct?.brand,
        gtin: ra.gtin || baseProduct?.gtin,
        mpn: ra.mpn || baseProduct?.mpn,
        specifications: {
          ...(typeof baseProduct?.specifications === 'object' ? baseProduct.specifications : {}),
          ...(typeof ra.specifications === 'object' ? ra.specifications : {})
        },
        brandModel: updatedSupplierProduct.attributes?.brandModel,
        lsa: updatedSupplierProduct.attributes?.lsa,
        hsnCode: updatedSupplierProduct.attributes?.hsnCode,
        price: updatedSupplierProduct.price,
        stock: updatedSupplierProduct.stock,
        igst_rate: updatedSupplierProduct.igst_rate ?? updatedSupplierProduct.attributes?.igstRate ?? null,
        cgst_rate: updatedSupplierProduct.cgst_rate ?? updatedSupplierProduct.attributes?.cgstRate ?? null,
        sgst_rate: updatedSupplierProduct.sgst_rate ?? updatedSupplierProduct.attributes?.sgstRate ?? null,
        location: updatedSupplierProduct.location,
        min_order_quantity: updatedSupplierProduct.min_order_quantity,
        status: updatedSupplierProduct.status,
        is_active: updatedSupplierProduct.is_active,
        supplier_id: updatedSupplierProduct.supplier_id,
        supplier_product_id: updatedSupplierProduct.id,
        variantKey: updatedSupplierProduct.variant_key,
        variantAsin: updatedSupplierProduct.variant_asin,
        images:
          sanitizeImageUrls(updatedSupplierProduct.attributes?.images).length > 0
            ? sanitizeImageUrls(updatedSupplierProduct.attributes?.images)
            : sanitizeImageUrls(baseProduct?.images)
      };

      console.log(
        `Supplier product ${updatedSupplierProduct.id} updated successfully. New location: "${updatedSupplierProduct.location}"`
      );

      // Notify admins about supplier inventory/tracking updates.
      // This branch updates `supplier_products` directly, which previously had no admin notification.
      try {
        const changes = [];

        // Price/stock/location/min order
        if (supplierProduct.price !== updatedSupplierProduct.price) {
          changes.push(`Price: ₹${supplierProduct.price} → ₹${updatedSupplierProduct.price}`);
        }
        if (supplierProduct.stock !== updatedSupplierProduct.stock) {
          changes.push(`Stock: ${supplierProduct.stock} → ${updatedSupplierProduct.stock}`);
        }
        if (supplierProduct.location !== updatedSupplierProduct.location) {
          changes.push(`Location: "${supplierProduct.location}" → "${updatedSupplierProduct.location}"`);
        }
        if (supplierProduct.min_order_quantity !== updatedSupplierProduct.min_order_quantity) {
          changes.push(
            `Min Order Qty: ${supplierProduct.min_order_quantity} → ${updatedSupplierProduct.min_order_quantity}`
          );
        }

        // Tracking attributes stored inside attributes JSONB
        const oldAttrs = supplierProduct.attributes || {};
        const newAttrs = updatedSupplierProduct.attributes || {};
        if ((oldAttrs.brandModel || '') !== (newAttrs.brandModel || '')) {
          changes.push(`BrandModel: ${oldAttrs.brandModel || '-'} → ${newAttrs.brandModel || '-'}`);
        }
        if ((oldAttrs.lsa || '') !== (newAttrs.lsa || '')) {
          changes.push(`LSA: ${oldAttrs.lsa || '-'} → ${newAttrs.lsa || '-'}`);
        }
        if (specificationsChanged) {
          changes.push('Specifications changed (requires admin approval)');
        }

        // If we couldn't infer changes (e.g., no actual diff), don't spam.
        if (changes.length > 0) {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
          const { data: admins } = await findAdmins(adminEmail, supabase);

          const { data: supplier } = await findUserBasicById(req.userId, supabase);

          if (admins && admins.length > 0) {
            const title = `Supplier Updated Inventory: ${responseProduct.name}`;
            const message = `${supplier?.name || 'Supplier'} updated "${responseProduct.name}". Changes: ${changes.join(
              ', '
            )}`;

            const notifications = admins.map((admin) => ({
              user_id: admin.id,
              type: 'supplier_edit',
              title,
              message,
              related_product_id: updatedSupplierProduct.product_id,
              related_supplier_id: req.userId,
              metadata: {
                productId: updatedSupplierProduct.product_id,
                supplierId: req.userId,
                supplierName: supplier?.name,
                productName: responseProduct.name,
                changes,
                price: updatedSupplierProduct.price,
                stock: updatedSupplierProduct.stock,
                location: updatedSupplierProduct.location,
                minOrderQuantity: updatedSupplierProduct.min_order_quantity,
                status: updatedSupplierProduct.status,
                isActive: updatedSupplierProduct.is_active
              },
              is_read: false
            }));

            await insertNotifications(notifications, supabase);
            console.log(`Created ${notifications.length} admin notification(s) for supplier inventory update`);
          }
        }
      } catch (notifErr) {
        console.log('⚠️ Failed to notify admins about supplier inventory update:', notifErr?.message || notifErr);
      }

      // Separate high-priority approval notification when specs changed.
      if (movedToPendingForSpecReview) {
        try {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
          const { data: admins } = await findAdmins(adminEmail, supabase);
          const { data: supplier } = await findUserBasicById(req.userId, supabase);
          if (admins && admins.length > 0) {
            const notifications = admins.map((admin) => ({
              user_id: admin.id,
              type: 'product_approval',
              title: `Spec Change Pending Approval: ${responseProduct.name}`,
              message: `${supplier?.name || 'Supplier'} updated specifications for "${responseProduct.name}". Review and approve this updated variant before it is active again.`,
              related_product_id: updatedSupplierProduct.product_id,
              related_supplier_id: req.userId,
              metadata: {
                productId: updatedSupplierProduct.product_id,
                supplierId: req.userId,
                supplierName: supplier?.name || null,
                supplierProductId: updatedSupplierProduct.id,
                variantKey: updatedSupplierProduct.variant_key,
                newSpecifications: nextSpecifications
              },
              is_read: false
            }));
            await insertNotifications(notifications, supabase);
          }
        } catch (approvalNotifErr) {
          console.log('⚠️ Failed to notify admins for spec-change approval:', approvalNotifErr?.message || approvalNotifErr);
        }
      }

      return res.json({
        status: 'success',
        message: movedToPendingForSpecReview
          ? 'Specifications updated. Product is now pending admin approval.'
          : 'Product updated successfully',
        product: responseProduct,
        nextStep: {
          type: 'bcov_setup',
          supplierProductId: responseProduct?.supplier_product_id || null,
          variantKey: responseProduct?.variantKey || null,
          variantAsin: responseProduct?.variantAsin || null,
          brand: String(
            responseProduct?.brandModel ||
              responseProduct?.brand ||
              responseProduct?.specifications?.brandModel ||
              responseProduct?.specifications?.brand ||
              ''
          ).trim(),
          productName: String(responseProduct?.name || '').trim()
        }
      });
    }

    if (supplierProductError && supplierProductError.code && supplierProductError.code !== 'PGRST116') {
      console.error('Error checking supplier_products for update:', supplierProductError);
    }

    // ============================
    // 2) Fallback: treat ID as products.id (backward compatibility)
    // ============================

    // Get the old product data before updating
    const { data: oldProduct, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !oldProduct) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found' 
      });
    }

    // Optional permission check: if product has a supplier_id, ensure it matches
    if (oldProduct.supplier_id && oldProduct.supplier_id !== req.userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to update this product'
      });
    }

    const { data: variantOffersForProduct } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', id)
      .eq('supplier_id', req.userId)
      .neq('status', 'rejected');
    if ((variantOffersForProduct || []).length > 1) {
      return res.status(400).json({
        status: 'error',
        message:
          'This catalog item has multiple variants on your account. Edit each variant from its own row so changes stay on that Variant TSIN only (do not update using the shared product id).'
      });
    }
    
    console.log(`Updating base product ${id} with data:`, {
      location: req.body.location,
      price: req.body.price,
      stock: req.body.stock,
      name: req.body.name
    });
    
    // Prepare update data
    const updateData = {
      ...req.body,
      specifications: req.body.specifications || oldProduct.specifications || {}
    };
    const legacySpecificationsChanged = shouldMoveToPendingForSpecChange({
      specificationsProvided: req.body.specifications !== undefined,
      currentSpecs: oldProduct.specifications || {},
      nextSpecs: updateData.specifications || {}
    });
    
    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.supplier_id;
    delete updateData.status; // Status can only be changed by admin
    delete updateData.approved_by;
    delete updateData.approved_at;
    // Supplier-only tracking fields belong in supplier_products.attributes, not products table.
    delete updateData.brandModel;
    delete updateData.lsa;
    delete updateData.hsnCode;
    delete updateData.hsn_code;
    delete updateData.brand_model;
    
    const { data: product, error: updateError } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError || !product) {
      console.error('Base product update error:', updateError);
      return res.status(400).json({ 
        status: 'error',
        message: updateError?.message || 'Failed to update product' 
      });
    }

    if (legacySpecificationsChanged) {
      await supabase
        .from('supplier_products')
        .update({
          status: 'pending',
          is_active: false,
          approved_by: null,
          approved_at: null,
          rejection_reason: null
        })
        .eq('product_id', product.id)
        .eq('supplier_id', req.userId);
    }
    
    // Get supplier info
    const { data: supplier } = await supabase
      .from('users')
      .select('name, email, company')
      .eq('id', req.userId)
      .single();
    
    // Track what changed
    const changes = [];
    if (oldProduct.name !== product.name) {
      changes.push(`Name: "${oldProduct.name}" → "${product.name}"`);
    }
    if (parseFloat(oldProduct.price) !== parseFloat(product.price)) {
      changes.push(`Price: ₹${oldProduct.price} → ₹${product.price}`);
    }
    if (oldProduct.stock !== product.stock) {
      changes.push(`Stock: ${oldProduct.stock} → ${product.stock}`);
    }
    if (oldProduct.category !== product.category) {
      changes.push(`Category: "${oldProduct.category}" → "${product.category}"`);
    }
    if (oldProduct.unit !== product.unit) {
      changes.push(`Unit: "${oldProduct.unit}" → "${product.unit}"`);
    }
    if (oldProduct.location !== product.location) {
      changes.push(`Location: "${oldProduct.location}" → "${product.location}"`);
    }
    if (oldProduct.description !== product.description) {
      changes.push(`Description updated`);
    }
    if (legacySpecificationsChanged) {
      changes.push('Specifications changed (requires admin approval)');
    }
    
    // Create notifications for all admins if there are changes
    if (changes.length > 0) {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);
      
      if (admins && admins.length > 0) {
        const notifications = admins.map(admin => ({
          user_id: admin.id,
          type: 'supplier_edit',
          title: `Supplier Edited Product: ${product.name}`,
          message: `${supplier?.name} (${supplier?.company || supplier?.email}) edited product "${product.name}". Changes: ${changes.join(', ')}`,
          related_product_id: product.id,
          related_supplier_id: supplier?.id || req.userId,
          metadata: {
            productName: product.name,
            supplierName: supplier?.name,
            supplierEmail: supplier?.email,
            supplierCompany: supplier?.company,
            changes: changes,
            oldData: {
              name: oldProduct.name,
              price: oldProduct.price,
              stock: oldProduct.stock,
              category: oldProduct.category,
              unit: oldProduct.unit,
              location: oldProduct.location
            },
            newData: {
              name: product.name,
              price: product.price,
              stock: product.stock,
              category: product.category,
              unit: product.unit,
              location: product.location
            }
          },
          is_read: false
        }));
      
        if (notifications.length > 0) {
          await insertNotifications(notifications, supabase);
          console.log(`Created ${notifications.length} admin notification(s) for product edit`);
        }
      }
    }
    
    console.log(`Base product ${product.id} updated successfully. New location: "${product.location}"`);
    
    res.json({
      status: 'success',
      message: legacySpecificationsChanged
        ? 'Specifications updated. Product is now pending admin approval.'
        : 'Product updated successfully',
      product,
      nextStep: {
        type: 'bcov_setup',
        supplierProductId: null,
        variantKey: null,
        variantAsin: null,
        brand: String(
          product?.brand ||
            product?.specifications?.brandModel ||
            product?.specifications?.brand ||
            ''
        ).trim(),
        productName: String(product?.name || '').trim()
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Delete product (supplier-specific entry, supports multiple locations)
router.delete('/products/:id', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierProductDeleteSchema, req.body || {});
    const supplierProductId = req.params.id;

    // Look up the supplier_products row to get product_id and validate ownership
    const { data: supplierProduct, error: fetchError } = await supabase
      .from('supplier_products')
      .select('id, product_id, supplier_id')
      .eq('id', supplierProductId)
      .single();

    if (fetchError || !supplierProduct) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found for this supplier'
      });
    }

    // Ensure the entry belongs to the current supplier
    if (supplierProduct.supplier_id !== req.userId) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to delete this product entry'
      });
    }

    const productId = supplierProduct.product_id;

    // Delete ONLY this supplier-specific entry from supplier_products
    const { data: deletedRows, error: spError } = await supabase
      .from('supplier_products')
      .delete()
      .eq('id', supplierProductId)
      .eq('supplier_id', req.userId)
      .select('id');
    
    if (spError) {
      console.error('Supplier product delete error:', spError);
      return res.status(400).json({
        status: 'error',
        message: spError.message || 'Failed to delete supplier product'
      });
    }

    // If no row was deleted, this product is not owned by this supplier
    if (!deletedRows || deletedRows.length === 0) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found for this supplier'
      });
      }

    // Optional cleanup: if no supplier_products remain for this product,
    // and the original products row is now orphaned, we can delete it.
    const { count, error: countError } = await supabase
      .from('supplier_products')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);

    if (!countError && (count || 0) === 0) {
      // No more supplier-specific entries; safe to delete the shared product row
      await supabase
        .from('products')
        .delete()
        .eq('id', productId);
    }
    
    res.json({ 
      status: 'success',
      message: 'Product deleted successfully' 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Delete product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get supplier orders
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    // Use retry logic for transient SSL/network errors
    const result = await retrySupabaseQuery(async () => {
      return await supabase
        .from('orders')
        .select(`
          *,
          service_provider:users!orders_service_provider_id_fkey (id, name, company, email, phone),
          order_items (
            *,
            product:products (id, name, category, unit, price)
          ),
          boq:boqs (id, name)
        `)
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false });
    }, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 5000
    });
    
    if (result.error) {
      // Check if it's a transient error that we couldn't recover from
      const errorMessage = result.error.message?.toLowerCase() || '';
      if (errorMessage.includes('ssl handshake') || errorMessage.includes('525') || errorMessage.includes('cloudflare')) {
        console.error('Get orders error (SSL/Network):', result.error.message?.substring(0, 200));
        // Return empty array instead of error for better UX
        return res.json({ 
          status: 'success',
          orders: [],
          warning: 'Unable to fetch orders due to network issues. Please try again in a moment.'
        });
      }
      throw result.error;
    }

    const rawOrders = result.data || [];
    const orderIds = rawOrders.map((o) => o.id).filter(Boolean);
    let invoiceByOrderId = new Map();
    if (orderIds.length > 0) {
      const { data: invoiceRows } = await supabase
        .from('invoices')
        .select('order_id, invoice_number, metadata')
        .in('order_id', orderIds);
      invoiceByOrderId = new Map((invoiceRows || []).map((inv) => [inv.order_id, inv]));
    }
    const ordersWithInvoices = rawOrders.map((o) => {
      const inv = invoiceByOrderId.get(o.id);
      return {
        ...o,
        invoiceNumber: inv?.invoice_number || null,
        invoicePdfUrl: inv?.metadata?.pdfUrl || null
      };
    });

    res.json({
      status: 'success',
      orders: ordersWithInvoices
    });
  } catch (error) {
    console.error('Get orders error:', error);
    
    // For network/SSL errors, return empty array instead of error
    const errorMessage = error.message?.toLowerCase() || String(error).toLowerCase();
    if (errorMessage.includes('ssl handshake') || errorMessage.includes('525') || errorMessage.includes('cloudflare') || errorMessage.includes('network')) {
      return res.json({ 
        status: 'success',
        orders: [],
        warning: 'Unable to fetch orders due to network issues. Please try again in a moment.'
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Inventory summary for the logged-in supplier (by outlet)
router.get('/inventory/summary', authenticateToken, async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('supplier_products')
      .select(`
        id,
        price,
        stock,
        status,
        is_active,
        outlet_id,
        product:products (id, name, category, unit),
        outlet:outlets (id, name, code)
      `)
      .eq('supplier_id', req.userId)
      // Hide rejected items from supplier inventory summary.
      .neq('status', 'rejected');

    if (error) {
      throw error;
    }

    const items = rows || [];

    // Overall totals
    let totalStockQty = 0;
    let totalStockValue = 0;

    // Group by outlet
    const outletsMap = {};

    for (const row of items) {
      const qty = parseInt(row.stock) || 0;
      const price = parseFloat(row.price) || 0;
      const value = qty * price;

      totalStockQty += qty;
      totalStockValue += value;

      const outletId = row.outlet_id || 'unassigned';
      if (!outletsMap[outletId]) {
        const outlet = row.outlet || {};
        outletsMap[outletId] = {
          outletId: outlet.id || null,
          outletCode: outlet.code || null,
          outletName: outlet.name || (outletId === 'unassigned' ? 'Unassigned' : 'Outlet'),
          totalStockQty: 0,
          totalStockValue: 0,
          productCount: 0
        };
      }

      outletsMap[outletId].totalStockQty += qty;
      outletsMap[outletId].totalStockValue += value;
      outletsMap[outletId].productCount += 1;
    }

    const outlets = Object.values(outletsMap);

    res.json({
      status: 'success',
      summary: {
        totalStockQty,
        totalStockValue,
        outletCount: outlets.length
      },
      outlets
    });
  } catch (error) {
    console.error('Supplier inventory summary error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Restock suggestions: for low-stock items, suggest nearest upstream suppliers for same product+brand.
router.get('/inventory/restock-suggestions', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can view restock suggestions' });
    }

    const threshold = Math.max(0, parseInt(req.query.threshold, 10) || 10);
    const limitPerItem = Math.min(5, Math.max(1, parseInt(req.query.limit, 10) || 3));

    // Load my low-stock offers
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, stock, outlet_id, location, attributes')
      .eq('supplier_id', req.userId)
      .eq('is_active', true)
      .neq('status', 'rejected')
      .lte('stock', threshold);

    if (myErr) throw myErr;

    const myOffers = myRows || [];
    if (myOffers.length === 0) {
      return res.json({ status: 'success', threshold, items: [] });
    }

    // Determine my outlet geo per offer (if available)
    const outletIds = [...new Set(myOffers.map((r) => r.outlet_id).filter(Boolean))];
    const outletGeoById = {};
    if (outletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, geo_location')
        .in('id', outletIds)
        .eq('is_active', true);
      for (const o of outs || []) {
        outletGeoById[o.id] = o.geo_location;
      }
    }

    // Union of immediate upstream partner types for every role the viewer declared (multi-role safe).
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const parentRolesLabel = [...parentRolesUnion]
      .sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99))
      .map((r) => SUPPLY_CHAIN_ROLE_LABELS[r] || r)
      .join(', ');

    if (parentRolesUnion.size === 0) {
      return res.json({
        status: 'success',
        threshold,
        items: myOffers.map((r) => ({
          supplierProductId: r.id,
          productId: r.product_id,
          stock: r.stock,
          suggestions: [],
          message: 'No upstream role available for your current supply-chain role (e.g. manufacturer has no upstream).'
        }))
      });
    }

    const viewerBrandTokens = getViewerBrandTokensUnionForAllRoles(req.user.profile);
    const { data: upstreamUsers } = await supabase
      .from('users')
      .select('id, name, company, address, profile')
      .eq('user_type', 'supplier')
      .eq('is_active', true)
      .neq('id', req.userId);

    const upstreamSupplierIds = (upstreamUsers || [])
      .filter((u) => u?.profile && sellerMatchesUpstreamRoles(u.profile, parentRolesUnion))
      .filter((u) => {
        if (!viewerBrandTokens || viewerBrandTokens.size === 0) return true;
        const partnerEntries = (
          Array.isArray(u.profile?.companyInfoEntries)
            ? u.profile.companyInfoEntries
            : u.profile?.companyInfoEntries && typeof u.profile.companyInfoEntries === 'object'
              ? [u.profile.companyInfoEntries]
              : []
        ).filter(
          (e) => e && parentRolesUnion.has(e.role)
        );
        if (partnerEntries.length > 0) {
          return partnerEntries.some((e) => entryOverlapsViewerBrands(e, viewerBrandTokens));
        }
        if (u.profile?.supplierRole && parentRolesUnion.has(u.profile.supplierRole)) {
          return entryOverlapsViewerBrands({ brands: u.profile?.brands || '' }, viewerBrandTokens);
        }
        return false;
      })
      .map((u) => u.id);

    if (upstreamSupplierIds.length === 0) {
      return res.json({
        status: 'success',
        threshold,
        items: myOffers.map((r) => ({
          supplierProductId: r.id,
          productId: r.product_id,
          stock: r.stock,
          suggestions: [],
          message: `No upstream suppliers found (${parentRolesLabel || 'matching roles'}) for your declared brands.`
        }))
      });
    }

    // Fetch upstream offers for all my product_ids at once
    const productIds = [...new Set(myOffers.map((r) => r.product_id).filter(Boolean))];
    if (productIds.length === 0) {
      return res.json({
        status: 'success',
        parentRole,
        parentRoles: parentRolesSorted,
        rankPriority: UPSTREAM_RANK_PRIORITY,
        limit: limitPerItem,
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id || null,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message:
            'Selected inventory item is not linked to a catalog product yet. Edit this item and map it to a product first.'
        }))
      });
    }
    const { data: upstreamOffers } = await supabase
      .from('supplier_products')
      .select('id, product_id, supplier_id, stock, price, outlet_id, location, status, is_active, attributes')
      .in('supplier_id', upstreamSupplierIds)
      .in('product_id', productIds)
      .eq('is_active', true)
      .neq('status', 'rejected')
      .gt('stock', 0);

    const upstreamByProduct = new Map();
    for (const row of upstreamOffers || []) {
      if (!row?.product_id) continue;
      if (!upstreamByProduct.has(row.product_id)) upstreamByProduct.set(row.product_id, []);
      upstreamByProduct.get(row.product_id).push(row);
    }

    // Load upstream outlets geo for distance calculation
    const upstreamOutletIds = [...new Set((upstreamOffers || []).map((r) => r.outlet_id).filter(Boolean))];
    const upstreamOutletGeoById = {};
    if (upstreamOutletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, supplier_id, geo_location')
        .in('id', upstreamOutletIds)
        .eq('is_active', true);
      for (const o of outs || []) upstreamOutletGeoById[o.id] = o.geo_location;
    }

    // Load upstream supplier display info map
    const upstreamUserMap = {};
    (upstreamUsers || []).forEach((u) => {
      upstreamUserMap[u.id] = u;
    });

    const items = myOffers.map((mine) => {
      const myGeo = mine.outlet_id ? outletGeoById[mine.outlet_id] : null;
      const desiredBrand = String(mine?.attributes?.brandModel || '').trim().toLowerCase();
      const candidates = (upstreamByProduct.get(mine.product_id) || [])
        .filter((u) => {
          if (!desiredBrand) return true;
          const b = String(u?.attributes?.brandModel || '').trim().toLowerCase();
          return b ? b === desiredBrand || b.includes(desiredBrand) || desiredBrand.includes(b) : true;
        })
        .map((u) => {
          const geo = u.outlet_id ? upstreamOutletGeoById[u.outlet_id] : null;
          const dist =
            myGeo && geo && typeof myGeo.lat === 'number' && typeof myGeo.lng === 'number' && typeof geo.lat === 'number' && typeof geo.lng === 'number'
              ? haversineKm(myGeo.lat, myGeo.lng, geo.lat, geo.lng)
              : null;
          const sup = upstreamUserMap[u.supplier_id];
          return {
            supplierProductId: u.id,
            supplierId: u.supplier_id,
            supplierName: sup?.name || sup?.company || 'Supplier',
            supplierCompany: sup?.company || '',
            role: parentRole,
            stock: u.stock,
            price: u.price,
            location: u.location,
            distanceKm: dist != null ? Math.round(dist * 10) / 10 : null
          };
        })
        .sort((a, b) => {
          // Prefer known distance, then nearest; else higher stock
          if (a.distanceKm != null && b.distanceKm == null) return -1;
          if (a.distanceKm == null && b.distanceKm != null) return 1;
          if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
          return (b.stock || 0) - (a.stock || 0);
        })
        .slice(0, limitPerItem);

      return {
        supplierProductId: mine.id,
        productId: mine.product_id,
        stock: mine.stock,
        brandModel: mine?.attributes?.brandModel || null,
        upstreamRole: parentRole,
        suggestions: candidates
      };
    });

    return res.json({ status: 'success', threshold, items });
  } catch (e) {
    console.error('Restock suggestions error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load restock suggestions' });
  }
});

/**
 * Upstream suggestions for supplier ordering:
 * - Input: supplier's selected supplier_products (by junction IDs)
 * - Output: matching upstream supplier offers per product (role-based + brand overlap),
 *   ordered by: nearest distance → highest stock → lowest price → highest rating (top `limit` per line, default 5).
 */
router.get('/upstream/suggestions', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can fetch upstream suggestions' });
    }

    const supplierProductIdsRaw = req.query.supplierProductIds;
    const supplierProductIds = Array.isArray(supplierProductIdsRaw)
      ? supplierProductIdsRaw
      : String(supplierProductIdsRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const limitPerItem = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));

    if (supplierProductIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'supplierProductIds is required (comma-separated)'
      });
    }

    // Load my selected supplier offers
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, stock, min_order_quantity, outlet_id, location, attributes, is_active, status')
      .eq('supplier_id', req.userId)
      .in('id', supplierProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected');

    if (myErr) throw myErr;

    const myOffers = myRows || [];
    if (myOffers.length === 0) {
      return res.json({ status: 'success', parentRole: null, parentRoles: [], items: [] });
    }

    // Fallback union of immediate upstream partner types for every role the buyer declared (multi-role safe).
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const parentRolesSorted = [...parentRolesUnion].sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99));
    const parentRole = parentRolesSorted[0] || null; // legacy single label (first tier toward MGF)

    if (parentRolesUnion.size === 0) {
      return res.json({
        status: 'success',
        parentRole: null,
        parentRoles: [],
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: 'No upstream role available for your current supply-chain role (e.g. manufacturer has no upstream).'
        }))
      });
    }

    const selectedBrandNames = [
      ...new Set(
        myOffers
          .map((r) => String(r?.attributes?.brandModel || '').trim())
          .filter(Boolean)
      )
    ];
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: selectedBrandNames
    });

    // Fetch upstream offers for selected product_ids (plus same-name products).
    // We match by product name (and category) because identity fields can differ across suppliers.
    const productIds = [...new Set(myOffers.map((r) => r.product_id).filter(Boolean))];

    const { data: myProductRows } = await supabase
      .from('products')
      .select('id, name, category')
      .in('id', productIds);

    // Build "equivalent" product ids by name similarity within the same category.
    // Keep it bounded: for each selected product, search a small set and then verify by normalized text in JS.
    const equivalentProductIdsSet = new Set(productIds);
    const matchProductIdsByMineProductId = {};

    const normalizeNameForMatch = (value) =>
      normalizeText(String(value || ''))
        .replace(/\b(the|a|an|new|model|edition)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokenSet = (value) =>
      new Set(
        normalizeNameForMatch(value)
          .split(' ')
          .map((t) => t.trim())
          .filter((t) => t && t.length >= 2)
      );

    const jaccard = (a, b) => {
      if (!a || !b || a.size === 0 || b.size === 0) return 0;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter += 1;
      const union = a.size + b.size - inter;
      return union > 0 ? inter / union : 0;
    };

    for (const p of myProductRows || []) {
      const rawName = String(p?.name || '').trim();
      const category = String(p?.category || '').trim();
      if (!rawName || !category) {
        matchProductIdsByMineProductId[p?.id] = [p?.id].filter(Boolean);
        continue;
      }

      // Search by ILIKE name in the same category.
      const { data: nameMatches } = await supabase
        .from('products')
        .select('id, name')
        .eq('category', category)
        .ilike('name', `%${rawName}%`)
        .limit(25);

      const normalizedInput = normalizeNameForMatch(rawName);
      const inputTokens = tokenSet(rawName);
      const verified = (nameMatches || [])
        .filter((row) => {
          const n = normalizeNameForMatch(row?.name || '');
          if (!n) return false;
          if (n === normalizedInput) return true;
          // Allow containment when names differ by minor suffix/prefix (e.g. "Mac Air M1 8GB" vs "Mac Air M1")
          if (normalizedInput.length >= 4 && (n.includes(normalizedInput) || normalizedInput.includes(n))) return true;
          // Token overlap fallback
          const score = jaccard(inputTokens, tokenSet(row?.name || ''));
          return score >= 0.65;
        })
        .map((row) => row.id)
        .filter(Boolean);

      // Always include itself.
      const merged = [...new Set([p.id, ...verified].filter(Boolean))];
      matchProductIdsByMineProductId[p.id] = merged;
      merged.forEach((id) => equivalentProductIdsSet.add(id));
    }

    const equivalentProductIds = [...equivalentProductIdsSet].filter(Boolean);
    if (equivalentProductIds.length === 0) {
      return res.json({
        status: 'success',
        parentRole,
        parentRoles: parentRolesSorted,
        rankPriority: UPSTREAM_RANK_PRIORITY,
        limit: limitPerItem,
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id || null,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: 'No catalog product id found for selected item(s).'
        }))
      });
    }

    // Load upstream offers directly (source of truth) and then load supplier profiles for display.
    const { data: upstreamOffers } = await supabase
      .from('supplier_products')
      .select('id, product_id, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity')
      .in('product_id', equivalentProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected')
      .gt('stock', 0);

    const upstreamSupplierIds = [
      ...new Set((upstreamOffers || []).map((o) => o.supplier_id).filter(Boolean))
    ].filter((id) => id !== req.userId);

    if (upstreamSupplierIds.length === 0) {
      const label = parentRolesSorted.map((r) => SUPPLY_CHAIN_ROLE_LABELS[r] || r).join(', ');
      return res.json({
        status: 'success',
        parentRole,
        parentRoles: parentRolesSorted,
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: `No upstream offers found (${label}) for your selected product(s).`
        }))
      });
    }

    // Brand overlap tokens: union of brandModel tokens from selected offers.
    const viewerBrandTokens = new Set();
    for (const r of myOffers) {
      parseBrandTokens(r?.attributes?.brandModel).forEach((t) => viewerBrandTokens.add(t));
    }

    // Load upstream suppliers (only those who actually have offers)
    const { data: upstreamUsers } = await supabase
      .from('users')
      .select('id, name, company, email, phone, address, profile')
      .eq('user_type', 'supplier')
      .eq('is_active', true)
      .in('id', upstreamSupplierIds);

    // Load upstream supplier display info map
    const upstreamUserMap = {};
    (upstreamUsers || []).forEach((u) => {
      upstreamUserMap[u.id] = u;
    });

    const upstreamByProduct = new Map();
    for (const row of upstreamOffers || []) {
      if (!row?.product_id) continue;
      // Never suggest the buyer's own listing as "upstream" (missing profile row used to pass the old !hasAnyRole bypass).
      if (row.supplier_id === req.userId) continue;
      if (!upstreamByProduct.has(row.product_id)) upstreamByProduct.set(row.product_id, []);
      upstreamByProduct.get(row.product_id).push(row);
    }

    // All of your outlet coordinates — distance to each upstream offer is the minimum km from ANY of these
    // (so a new dealer opening near any of your locations surfaces as #1 on the next fetch; not fixed to one outlet).
    const buyerOutletGeos = [];
    const buyerGeoDiagnostics = {
      outletsChecked: 0,
      outletsResolved: 0,
      profileAddressTried: false,
      profileAddressResolved: false,
      branchesTried: 0,
      branchesResolved: 0,
      inventoryLocationTried: 0,
      inventoryLocationResolved: 0
    };
    let buyerGeoSource = 'none';
    const { data: buyerOutletsGeoRows } = await supabase
      .from('outlets')
      .select('id, geo_location, address')
      .eq('supplier_id', req.userId)
      .eq('is_active', true)
      .limit(120);
    buyerGeoDiagnostics.outletsChecked = (buyerOutletsGeoRows || []).length;
    for (const o of buyerOutletsGeoRows || []) {
      const g = await resolveGeoFromOutletAddress(o?.geo_location, o?.address);
      if (g && typeof g.lat === 'number' && typeof g.lng === 'number') {
        buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
        buyerGeoDiagnostics.outletsResolved += 1;
      }
    }
    if (buyerOutletGeos.length > 0) buyerGeoSource = 'outlet';
    // Retailers may not have outlet rows; fall back to profile/address geocode.
    if (buyerOutletGeos.length === 0) {
      const { data: buyerUser } = await supabase
        .from('users')
        .select('address, profile')
        .eq('id', req.userId)
        .maybeSingle();
      buyerGeoDiagnostics.profileAddressTried = true;
      const buyerGeoFallback = await resolveGeoFromOutletAddress(null, buyerUser?.address || null);
      if (isValidGeoLocation(buyerGeoFallback)) {
        buyerOutletGeos.push({ lat: buyerGeoFallback.lat, lng: buyerGeoFallback.lng });
        buyerGeoSource = 'profile_address';
        buyerGeoDiagnostics.profileAddressResolved = true;
      }
      // Backward compatibility: many suppliers still store branch locations in profile.branches.
      if (buyerOutletGeos.length === 0) {
        const legacyBranches = Array.isArray(buyerUser?.profile?.branches) ? buyerUser.profile.branches : [];
        buyerGeoDiagnostics.branchesTried = legacyBranches.length;
        for (const branch of legacyBranches) {
          const branchAddr = buildOutletAddressString(branch);
          if (!branchAddr) continue;
          const g = await resolveGeoFromOutletAddress(null, branchAddr);
          if (isValidGeoLocation(g)) {
            buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
            buyerGeoSource = 'profile_branches';
            buyerGeoDiagnostics.branchesResolved += 1;
            break;
          }
        }
      }
    }
    // Additional fallback: use selected inventory location text if retailer has no outlet/address geo.
    if (buyerOutletGeos.length === 0) {
      const buyerLocationTexts = [...new Set((myOffers || []).map((r) => String(r?.location || '').trim()).filter(Boolean))];
      buyerGeoDiagnostics.inventoryLocationTried = buyerLocationTexts.length;
      for (const locText of buyerLocationTexts) {
        const g = await geocodeAddressNominatim(locText);
        if (isValidGeoLocation(g)) {
          buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
          buyerGeoSource = 'inventory_location_text';
          buyerGeoDiagnostics.inventoryLocationResolved += 1;
          break;
        }
      }
    }

    // Load upstream outlet geo for distance calc
    const upstreamOutletIds = [...new Set((upstreamOffers || []).map((r) => r.outlet_id).filter(Boolean))];
    const upstreamOutletGeoById = {};
    const upstreamOutletAddressTextById = {};
    if (upstreamOutletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, geo_location, address')
        .in('id', upstreamOutletIds)
        .eq('is_active', true);
      for (const o of outs || []) {
        const g = await resolveGeoFromOutletAddress(o?.geo_location, o?.address);
        if (isValidGeoLocation(g)) upstreamOutletGeoById[o.id] = g;
        const addrText = buildOutletAddressString(o?.address || '');
        if (addrText) upstreamOutletAddressTextById[o.id] = addrText;
      }
    }

    // Fallback: if an offer has no resolvable outlet geo, try geocoding its location text.
    const offerGeoByOfferId = {};
    const locationGeoCache = new Map();
    const supplierGeoCache = new Map();
    const supplierBranchGeoCache = new Map();
    for (const offer of upstreamOffers || []) {
      let geoSource = 'none';
      let geo = offer?.outlet_id ? upstreamOutletGeoById[offer.outlet_id] : null;
      if (isValidGeoLocation(geo)) geoSource = 'outlet';
      if (!isValidGeoLocation(geo)) {
        const locText = String(offer?.location || '').trim();
        if (locText) {
          if (!locationGeoCache.has(locText)) {
            locationGeoCache.set(locText, await geocodeAddressNominatim(locText));
          }
          const approx = locationGeoCache.get(locText);
          if (isValidGeoLocation(approx)) {
            geo = approx;
            geoSource = 'offer_location_text';
          }
        }
      }
      if (!isValidGeoLocation(geo)) {
        const sup = upstreamUserMap[offer.supplier_id];
        if (sup?.id) {
          if (!supplierGeoCache.has(sup.id)) {
            supplierGeoCache.set(sup.id, await resolveGeoFromOutletAddress(null, sup.address || null));
          }
          const approxAddrGeo = supplierGeoCache.get(sup.id);
          if (isValidGeoLocation(approxAddrGeo)) {
            geo = approxAddrGeo;
            geoSource = 'supplier_profile_address';
          }
        }
      }
      // Legacy fallback: many suppliers only saved branch locations in profile.branches.
      if (!isValidGeoLocation(geo)) {
        const sup = upstreamUserMap[offer.supplier_id];
        if (sup?.id) {
          if (!supplierBranchGeoCache.has(sup.id)) {
            let branchGeo = null;
            const branches = Array.isArray(sup?.profile?.branches) ? sup.profile.branches : [];
            for (const branch of branches) {
              const branchAddr = buildOutletAddressString(branch);
              if (!branchAddr) continue;
              const g = await resolveGeoFromOutletAddress(null, branchAddr);
              if (isValidGeoLocation(g)) {
                branchGeo = g;
                break;
              }
            }
            supplierBranchGeoCache.set(sup.id, branchGeo);
          }
          const approxBranchGeo = supplierBranchGeoCache.get(sup.id);
          if (isValidGeoLocation(approxBranchGeo)) {
            geo = approxBranchGeo;
            geoSource = 'supplier_profile_branches';
          }
        }
      }
      offerGeoByOfferId[offer.id] = isValidGeoLocation(geo) ? { geo, source: geoSource } : null;
    }

    // Precompute nearest road distance from buyer outlets to each upstream offer.
    // This avoids straight-line bias and keeps ranking stable for delivery relevance.
    const roadDistanceKmByOfferId = {};
    if (buyerOutletGeos.length > 0) {
      const uniqueOfferGeoEntries = [];
      const geoKeyToIndex = new Map();
      const offerIdToGeoIndex = new Map();
      for (const offer of upstreamOffers || []) {
        const geoInfo = offerGeoByOfferId[offer.id];
        const geo = geoInfo?.geo;
        if (!geo || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') continue;
        const geoKey = `${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}`;
        let idx = geoKeyToIndex.get(geoKey);
        if (idx == null) {
          idx = uniqueOfferGeoEntries.length;
          uniqueOfferGeoEntries.push(geo);
          geoKeyToIndex.set(geoKey, idx);
        }
        offerIdToGeoIndex.set(offer.id, idx);
      }

      if (uniqueOfferGeoEntries.length > 0) {
        const minRoadKmByGeoIdx = await getMinDrivingDistanceFromOriginsKm(
          buyerOutletGeos,
          uniqueOfferGeoEntries
        );
        for (const offer of upstreamOffers || []) {
          const geoInfo = offerGeoByOfferId[offer.id];
          const geo = geoInfo?.geo;
          const geoIdx = offerIdToGeoIndex.get(offer.id);
          const roadKm = typeof geoIdx === 'number' ? minRoadKmByGeoIdx[geoIdx] : null;
          if (roadKm != null && Number.isFinite(roadKm)) {
            roadDistanceKmByOfferId[offer.id] = roadKm;
            continue;
          }
          if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
            // Fallback only when routing API cannot resolve.
            roadDistanceKmByOfferId[offer.id] = minHaversineKmBuyerOutletsToSeller(buyerOutletGeos, geo);
          } else {
            roadDistanceKmByOfferId[offer.id] = null;
          }
        }
      }
    }

    // Average supplier ratings (from past orders — service providers and chain buyers)
    const ratingSumBySupplier = new Map();
    const ratingCountBySupplier = new Map();
    if (upstreamSupplierIds.length > 0) {
      const { data: ratingRows } = await supabase
        .from('supplier_ratings')
        .select('supplier_id, rating')
        .in('supplier_id', upstreamSupplierIds);
      for (const row of ratingRows || []) {
        const sid = row.supplier_id;
        if (!sid) continue;
        const rv = parseFloat(row.rating);
        if (!Number.isFinite(rv)) continue;
        ratingCountBySupplier.set(sid, (ratingCountBySupplier.get(sid) || 0) + 1);
        ratingSumBySupplier.set(sid, (ratingSumBySupplier.get(sid) || 0) + rv);
      }
    }

    const getSupplierRatingSummary = (supplierId) => {
      const n = ratingCountBySupplier.get(supplierId) || 0;
      if (!n) return { averageRating: null, ratingCount: 0 };
      const avg = ratingSumBySupplier.get(supplierId) / n;
      return { averageRating: Math.round(avg * 100) / 100, ratingCount: n };
    };

    const items = myOffers.map((mine) => {
      const desiredBrand = String(mine?.attributes?.brandModel || '').trim().toLowerCase();
      const brandKey = normalizeBrandKeyFromAttributes(mine?.attributes?.brandModel);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const chainRouting = resolveRequiredUpstreamRoleFromAdminChain({
        profile: req.user.profile || {},
        brandKey,
        chainRow
      });
      const allowedRolesSet =
        chainRouting.requiredUpstreamRole && SUPPLIER_ROLE_SET.has(chainRouting.requiredUpstreamRole)
          ? new Set([chainRouting.requiredUpstreamRole])
          : parentRolesUnion;

      // Collect offers for this exact product_id AND any same-name equivalents in the same category.
      const equivalentIdsForMine =
        matchProductIdsByMineProductId[mine.product_id] && Array.isArray(matchProductIdsByMineProductId[mine.product_id])
          ? matchProductIdsByMineProductId[mine.product_id]
          : [mine.product_id].filter(Boolean);

      const upstreamOfferPool = [];
      for (const pid of equivalentIdsForMine) {
        const rows = upstreamByProduct.get(pid) || [];
        upstreamOfferPool.push(...rows);
      }

      const candidates = upstreamOfferPool
        .filter((u) => {
          if (!desiredBrand) return true;
          const b = String(u?.attributes?.brandModel || '').trim().toLowerCase();
          return b ? b === desiredBrand || b.includes(desiredBrand) || desiredBrand.includes(b) : true;
        })
        .filter((offer) => {
          if (!offer.supplier_id || offer.supplier_id === req.userId) return false;
          const sup = upstreamUserMap[offer.supplier_id];
          if (!sup?.profile) return false;
          return sellerMatchesUpstreamRoles(sup.profile, allowedRolesSet);
        })
        .map((u) => {
          const geoInfo = offerGeoByOfferId[u.id] || null;
          const geo = geoInfo?.geo || null;
          const distRaw =
            roadDistanceKmByOfferId[u.id] != null ? roadDistanceKmByOfferId[u.id] : null;
          const dist = distRaw != null ? Math.round(distRaw * 10) / 10 : null;
          const sup = upstreamUserMap[u.supplier_id];
          const outletAddressText = u?.outlet_id ? upstreamOutletAddressTextById[u.outlet_id] || '' : '';
          const supplierAddressText = buildOutletAddressString(sup?.address || '');
          const supplierBranchAddressText = getFirstSupplierBranchAddressText(sup?.profile || {});
          const offerLocationText = String(u?.location || '').trim();
          let locationDisplay = '';
          let locationSource = null;
          if (offerLocationText) {
            locationDisplay = offerLocationText;
            locationSource = 'offer_location';
          } else if (outletAddressText) {
            locationDisplay = outletAddressText;
            locationSource = 'offer_outlet_address';
          } else if (supplierAddressText) {
            locationDisplay = supplierAddressText;
            locationSource = 'supplier_profile_address';
          } else if (supplierBranchAddressText) {
            locationDisplay = supplierBranchAddressText;
            locationSource = 'supplier_profile_branches';
          }
          const matchedRole = sup ? pickMatchingUpstreamRoleForSeller(sup.profile, allowedRolesSet) : null;
          const roleForMap = matchedRole || parentRole;
          const { averageRating, ratingCount } = getSupplierRatingSummary(u.supplier_id);
          const supplierDetails =
            sup && roleForMap
              ? (mapSupplyChainPartner(sup, roleForMap, viewerBrandTokens) || {
                  id: sup.id,
                  name: sup.name,
                  company: sup.company || '',
                  phone: sup.phone || '',
                  email: sup.email || '',
                  address: sup.address || {},
                  supplierRole: roleForMap,
                  supplierRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[roleForMap] || roleForMap,
                  brands: sup?.profile?.brands || ''
                })
              : null;
          return {
            supplierId: u.supplier_id,
            supplierName: sup?.name || sup?.company || 'Supplier',
            supplierCompany: sup?.company || '',
            upstreamRole: roleForMap,
            mineSupplierProductId: mine.id,
            upstreamSupplierProductId: u.id,
            productId: mine.product_id,
            offerStatus: u.status,
            isActive: u.is_active,
            stock: u.stock,
            price: u.price,
            minOrderQuantity: u.min_order_quantity,
            location: locationDisplay,
            locationSource,
            offerOutletAddress: outletAddressText || null,
            offerGeoLocation: geo || null,
            distanceSource: geoInfo?.source || null,
            brandModel: u?.attributes?.brandModel || null,
            supplierDetails,
            distanceKm: dist,
            distanceKmRaw: distRaw,
            averageRating,
            ratingCount,
            minimumOrderValueInr: roleForMap
              ? getMinimumOrderValueInrForSellerRole(sup?.profile || {}, roleForMap)
              : 0
          };
        });

      const deduped = dedupeUpstreamCandidatesBySupplierPreferClosest(candidates);
      const ranked = rankUpstreamOffersForProduct(deduped);
      const top = ranked.slice(0, limitPerItem).map(({ distanceKmRaw: _r, ...rest }) => rest);

      return {
        mineSupplierProductId: mine.id,
        productId: mine.product_id,
        brandModel: mine?.attributes?.brandModel || null,
        upstreamRole: parentRole,
        upstreamRoles: parentRolesSorted,
        chainRouting: {
          source: chainRouting.source,
          brand: chainRow?.category_name || mine?.attributes?.brandModel || null,
          buyerRole: chainRouting.buyerRole,
          requiredUpstreamRole: chainRouting.requiredUpstreamRole,
          chainRoles: chainRouting.chainRoles
        },
        upstreamOffers: top
      };
    });

    return res.json({
      status: 'success',
      parentRole,
      parentRoles: parentRolesSorted,
      rankPriority: UPSTREAM_RANK_PRIORITY,
      limit: limitPerItem,
      distanceAvailable: buyerOutletGeos.length > 0,
      buyerGeoSource,
      buyerGeoDiagnostics,
      chainPolicy: 'brand_admin_chain_with_profile_fallback',
      distanceRanking:
        buyerOutletGeos.length > 0
          ? 'Each run uses current outlet coordinates. Distance is the minimum km from any of your outlets to the partner’s outlet; the nearest partner ranks first (not a fixed previous choice).'
          : 'Distance ranking is unavailable because your location could not be resolved. Add/update outlet geo or a complete address in profile (city/state/pincode).',
      items
    });
  } catch (e) {
    console.error('Upstream suggestions error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream suggestions' });
  }
});

/**
 * Create upstream order(s): supplier (buyer) -> upstream supplier(s) (seller)
 *
 * Body:
 * {
 *   lines: [
 *     { mineSupplierProductId, upstreamSupplierProductId, quantity }
 *   ]
 * }
 */
router.post('/upstream/orders', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can create upstream orders' });
    }

    const payloadInput = parseWithSchema(supplierUpstreamOrdersSchema, req.body || {});
    const { lines } = payloadInput;

    const mineIds = [...new Set(lines.map((l) => l?.mineSupplierProductId).filter(Boolean))];
    const upstreamOfferIds = [...new Set(lines.map((l) => l?.upstreamSupplierProductId).filter(Boolean))];

    // Validate my selected supplier products
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, attributes')
      .eq('supplier_id', req.userId)
      .in('id', mineIds);
    if (myErr) throw myErr;
    const myByMineId = {};
    (myRows || []).forEach((r) => (myByMineId[r.id] = r));

    const { data: upstreamOffers, error: upstreamErr } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, price, stock, min_order_quantity, attributes, outlet_id, location, product:products(id, name, category, unit, description, specifications, brand)')
      .eq('is_active', true)
      .neq('status', 'rejected')
      .in('id', upstreamOfferIds);
    if (upstreamErr) throw upstreamErr;

    const upstreamOfferById = {};
    (upstreamOffers || []).forEach((r) => (upstreamOfferById[r.id] = r));

    // Security guard: seller must match at least one immediate upstream role for any role the buyer declared.
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const selectedBrandNames = [
      ...new Set(
        (myRows || [])
          .map((r) => String(r?.attributes?.brandModel || '').trim())
          .filter(Boolean)
      )
    ];
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: selectedBrandNames
    });

    if (parentRolesUnion.size === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'No upstream role available for your current supply-chain role (e.g. manufacturer cannot place upstream orders).'
      });
    }

    const upstreamSupplierIds = [...new Set((upstreamOffers || []).map((r) => r.supplier_id).filter(Boolean))];
    const { data: upstreamUsers } = await supabase
      .from('users')
      .select('id, profile')
      .in('id', upstreamSupplierIds);

    const upstreamProfileById = {};
    (upstreamUsers || []).forEach((u) => {
      upstreamProfileById[u.id] = u.profile;
    });

    // Group lines by upstream supplier (order per supplier)
    const groups = new Map(); // supplier_id -> { supplierId, items: [...] }

    for (const line of lines) {
      const mineSupplierProductId = line?.mineSupplierProductId;
      const upstreamSupplierProductId = line?.upstreamSupplierProductId;
      const rawQty = line?.quantity;
      const quantity = parseInt(rawQty, 10);

      if (!mineSupplierProductId || !upstreamSupplierProductId) {
        return res.status(400).json({ status: 'error', message: 'mineSupplierProductId and upstreamSupplierProductId are required for each line' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ status: 'error', message: 'quantity must be a positive integer for each line' });
      }

      const myOffer = myByMineId[mineSupplierProductId];
      const myProductId = myOffer?.product_id;
      if (!myOffer || !myProductId) {
        return res.status(403).json({ status: 'error', message: 'One of the selected items is not owned by you' });
      }

      const upstreamOffer = upstreamOfferById[upstreamSupplierProductId];
      if (!upstreamOffer) {
        return res.status(404).json({ status: 'error', message: 'One of the selected upstream offers no longer exists' });
      }

      if (upstreamOffer.product_id !== myProductId) {
        return res.status(400).json({ status: 'error', message: 'Selected upstream offer does not match the chosen product' });
      }

      const minQty = parseInt(upstreamOffer.min_order_quantity || 1, 10) || 1;
      if (quantity < minQty) {
        return res.status(400).json({ status: 'error', message: `Quantity for ${upstreamOffer.product_id} must be >= ${minQty}` });
      }

      const supplierId = upstreamOffer.supplier_id;

      if (supplierId === req.userId) {
        return res.status(400).json({ status: 'error', message: 'You cannot place an upstream order to your own listing.' });
      }

      const upProfile = upstreamProfileById[supplierId];
      const brandKey = normalizeBrandKeyFromAttributes(myOffer?.attributes?.brandModel);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const chainRouting = resolveRequiredUpstreamRoleFromAdminChain({
        profile: req.user.profile || {},
        brandKey,
        chainRow
      });
      const allowedRolesSet =
        chainRouting.requiredUpstreamRole && SUPPLIER_ROLE_SET.has(chainRouting.requiredUpstreamRole)
          ? new Set([chainRouting.requiredUpstreamRole])
          : parentRolesUnion;

      if (!sellerMatchesUpstreamRoles(upProfile, allowedRolesSet)) {
        return res.status(403).json({
          status: 'error',
          message:
            chainRouting.source === 'admin_chain' && chainRouting.requiredUpstreamRole
              ? `Selected upstream offer is not in the admin-defined next role for this brand. Required role: ${SUPPLY_CHAIN_ROLE_LABELS[chainRouting.requiredUpstreamRole] || chainRouting.requiredUpstreamRole}.`
              : 'Selected upstream offer is not allowed for your supply-chain role(s).'
        });
      }

      if (!groups.has(supplierId)) groups.set(supplierId, { supplierId, items: [] });
      groups.get(supplierId).items.push({
        mineSupplierProductId,
        upstreamSupplierProductId,
        quantity,
        unitPrice: parseFloat(upstreamOffer.price || 0) || 0,
        upstreamOffer,
        chainRouting
      });
    }

    // Minimum order value (INR) per upstream seller — sum of lines to that supplier must meet their profile MOV
    for (const group of groups.values()) {
      const upProfile = upstreamProfileById[group.supplierId];
      const requiredRoles = group.items
        .map((it) => it?.chainRouting?.requiredUpstreamRole)
        .filter((r) => r && SUPPLIER_ROLE_SET.has(r));
      const allowedRolesForMov =
        requiredRoles.length > 0 ? new Set(requiredRoles) : parentRolesUnion;
      const matchedRole = pickMatchingUpstreamRoleForSeller(upProfile, allowedRolesForMov);
      const mov = getMinimumOrderValueInrForSellerRole(upProfile || {}, matchedRole || '');
      if (mov <= 0) continue;
      let subtotal = 0;
      for (const it of group.items) {
        subtotal += (parseInt(it.quantity, 10) || 0) * (parseFloat(it.unitPrice) || 0);
      }
      subtotal = Math.round(subtotal * 100) / 100;
      if (subtotal + 1e-6 < mov) {
        return res.status(400).json({
          status: 'error',
          code: 'minimum_order_value_not_met',
          message: `Minimum order value for this supplier is ₹${mov.toLocaleString('en-IN')}. Your order total to them is ₹${subtotal.toLocaleString('en-IN')}. Increase quantity or add lines to reach the minimum.`,
          minimumOrderValueInr: mov,
          orderSubtotalInr: subtotal,
          supplierId: group.supplierId
        });
      }
    }

    const buyer = await supabase
      .from('users')
      .select('name, company')
      .eq('id', req.userId)
      .single();

    const buyerName = buyer?.data?.name || buyer?.data?.company || 'Supplier';

    const createdOrders = [];

    for (const group of groups.values()) {
      const supplierId = group.supplierId;

      const orderItems = group.items.map((it) => {
        const up = it.upstreamOffer;
        const identity = buildIdentityBundle({
          name: up.product?.name || '',
          category: up.product?.category || '',
          brand: up.product?.brand || up?.attributes?.brandModel || up?.attributes?.brand || '',
          unit: up.product?.unit || '',
          packSize: up.attributes?.packSize || '',
          brandModel: up.attributes?.brandModel || null,
          gtin: up.attributes?.gtin || null,
          mpn: up.attributes?.mpn || null
        });

        return {
          product_id: up.product_id,
          supplier_product_id: it.upstreamSupplierProductId,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          total_price: it.unitPrice * it.quantity,
          specifications: JSON.stringify({
            snapshotAt: new Date().toISOString(),
            brandModel: up?.attributes?.brandModel || null,
            identity
          })
        };
      });

      const totalAmount = orderItems.reduce((sum, li) => sum + parseFloat(li.total_price || 0), 0);
      let order = null;
      let orderErr = null;
      for (let attempt = 0; attempt <= ORDER_INSERT_MAX_RETRIES; attempt++) {
        const orderInsertResult = await supabase
          .from('orders')
          .insert({
            service_provider_id: req.userId, // buyer = current supplier
            supplier_id: supplierId, // seller = upstream supplier
            total_amount: totalAmount,
            expected_delivery_date: null,
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'online',
            channel: 'b2b_po',
            outlet_id: null,
            status_history: [{
              status: 'confirmed',
              updatedBy: req.userId,
              notes: 'Upstream order created and confirmed by supplier',
              timestamp: new Date().toISOString()
            }],
            is_active: true
          })
          .select()
          .single();
        order = orderInsertResult.data || null;
        orderErr = orderInsertResult.error || null;
        if (!orderErr && order) {
          break;
        }
        if (!isOrderNumberConflictError(orderErr) || attempt === ORDER_INSERT_MAX_RETRIES) {
          break;
        }
      }

      if (orderErr || !order) {
        console.error('[Upstream Orders] order insert error:', orderErr);
        throw new Error(orderErr?.message || 'Failed to create upstream order');
      }

      const orderItemsWithOrderId = orderItems.map((oi) => ({ ...oi, order_id: order.id }));
      const { data: insertedItems, error: itemsErr } = await supabase
        .from('order_items')
        .insert(orderItemsWithOrderId)
        .select();

      if (itemsErr) {
        console.error('[Upstream Orders] order_items insert error:', itemsErr);
        await supabase.from('orders').delete().eq('id', order.id);
        throw new Error('Failed to create upstream order items');
      }

      // Inventory movement: decrease upstream seller stock
      try {
        for (const inserted of insertedItems || []) {
          const matchingLine = group.items.find((li) => li.upstreamSupplierProductId === inserted.supplier_product_id);
          const qty = parseFloat(inserted.quantity || 0) || 0;
          const up = inserted.supplier_product_id ? upstreamOfferById[inserted.supplier_product_id] : null;
          if (!matchingLine || !up) continue;

          await recordInventoryMovement({
            supplierProductId: inserted.supplier_product_id,
            supplierId: supplierId,
            productId: up.product_id,
            quantityChange: -qty,
            movementType: 'sale_online',
            referenceOrderId: order.id,
            referenceOrderItemId: inserted.id,
            notes: 'B2B upstream order created from supplier portal',
            userId: req.userId
          });
        }
      } catch (invErr) {
        // Do not fail the order creation if inventory logging fails; monitor via logs.
        console.error('[Upstream Orders] inventory movement error:', invErr);
      }

      // Notify upstream supplier
      try {
        const { data: supplierUser } = await supabase
          .from('users')
          .select('name, company')
          .eq('id', supplierId)
          .single();

        const supplierName = supplierUser?.name || supplierUser?.company || 'Supplier';

        await insertNotification({
          user_id: supplierId,
          type: 'order_status',
          title: 'New Upstream Order Received',
          message: `You have received an upstream order ${order.order_number} from ${buyerName}.`,
          related_order_id: order.id,
          is_read: false,
          metadata: {
            buyerId: req.userId
          }
        }, supabase);
      } catch (notifErr) {
        console.error('[Upstream Orders] notification error:', notifErr);
      }

      createdOrders.push({
        id: order.id,
        orderNumber: order.order_number,
        supplierId: order.supplier_id,
        totalAmount,
        status: order.status,
        paymentStatus: order.payment_status
      });
    }

    return res.json({
      status: 'success',
      orders: createdOrders,
      message: `Successfully created ${createdOrders.length} upstream order(s)`
    });
  } catch (error) {
    console.error('Upstream order creation error:', error);
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to create upstream orders', error: error.message });
  }
});

router.get('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can access upstream cart' });
    }

    const { data: cart, error } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at, created_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (error) throw error;

    return res.json({
      status: 'success',
      cart: cart
        ? {
            id: cart.id,
            draft: cart.draft_payload || {},
            updatedAt: cart.updated_at,
            createdAt: cart.created_at
          }
        : null
    });
  } catch (error) {
    console.error('Get upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream cart' });
  }
});

router.put('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can save upstream cart' });
    }

    const payloadInput = parseWithSchema(supplierUpstreamCartSaveSchema, req.body || {});
    const draftPayload = {
      mode: 'supplier_upstream',
      selectedMine: payloadInput.selectedMine || {},
      selectedUpstreamOffer: payloadInput.selectedUpstreamOffer || {},
      suggestions: Array.isArray(payloadInput.suggestions) ? payloadInput.suggestions : [],
      brandFilter: String(payloadInput.brandFilter || '').trim(),
      searchTerm: String(payloadInput.searchTerm || '').trim()
    };

    const { data: saved, error } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: draftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (error) throw error;

    return res.json({
      status: 'success',
      message: 'Upstream cart saved successfully',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save upstream cart' });
  }
});

router.delete('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can clear upstream cart' });
    }
    const { error } = await supabase
      .from('po_carts')
      .delete()
      .eq('service_provider_id', req.userId);
    if (error) throw error;
    return res.json({ status: 'success', message: 'Upstream cart cleared successfully' });
  } catch (error) {
    console.error('Clear upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to clear upstream cart' });
  }
});

/**
 * List upstream orders created by this supplier (as buyer).
 */
router.get('/upstream/orders', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can view upstream orders' });
    }

    const wantsAll =
      String(req.query.all || '')
        .trim()
        .toLowerCase() === 'true';
    const requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = wantsAll
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 500)
        : 50;

    let query = supabase
      .from('orders')
      .select(`
        id,
        order_number,
        supplier_id,
        total_amount,
        status,
        payment_status,
        payment_method,
        channel,
        created_at,
        updated_at,
        expected_delivery_date,
        actual_delivery_date,
        status_history,
        tracking_number,
        tracking_url,
        shipping_provider,
        order_items (id),
        supplier:users!orders_supplier_id_fkey (id, name, company)
      `)
      .eq('service_provider_id', req.userId)
      .eq('channel', 'b2b_po')
      .order('created_at', { ascending: false });

    if (limit != null) {
      query = query.limit(limit);
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    return res.json({
      status: 'success',
      orders: (orders || []).map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        supplierId: o.supplier_id,
        supplierName: o.supplier?.name || o.supplier?.company || 'Supplier',
        totalAmount: parseFloat(o.total_amount || 0),
        status: o.status,
        paymentStatus: o.payment_status || 'pending',
        channel: o.channel || null,
        createdAt: o.created_at,
        updatedAt: o.updated_at || o.created_at,
        expectedDeliveryDate: o.expected_delivery_date || null,
        actualDeliveryDate: o.actual_delivery_date || null,
        statusHistory: Array.isArray(o.status_history) ? o.status_history : [],
        trackingNumber: o.tracking_number || null,
        trackingUrl: o.tracking_url || null,
        shippingProvider: o.shipping_provider || null,
        itemCount: Array.isArray(o.order_items) ? o.order_items.length : 0
      }))
    });
  } catch (e) {
    console.error('Upstream orders list error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream orders' });
  }
});

// Inventory movement history and channel breakdown for a specific supplier_product
router.get('/inventory/:id/history', authenticateToken, async (req, res) => {
  try {
    const supplierProductId = req.params.id;

    // Ensure the supplier_product belongs to this supplier
    const { data: supplierProduct, error: spError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, stock')
      .eq('id', supplierProductId)
      .single();

    if (spError || !supplierProduct || supplierProduct.supplier_id !== req.userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Inventory entry not found for this supplier'
      });
    }

    const { data: movements, error: movError } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('supplier_product_id', supplierProductId)
      .order('created_at', { ascending: true });

    if (movError) {
      throw movError;
    }

    let onlineSold = 0;
    let offlineSold = 0;

    (movements || []).forEach(m => {
      if (m.movement_type === 'sale_online') {
        onlineSold += -(parseInt(m.quantity_change) || 0);
      } else if (m.movement_type === 'sale_offline') {
        offlineSold += -(parseInt(m.quantity_change) || 0);
      }
    });

    res.json({
      status: 'success',
      supplierProductId,
      productId: supplierProduct.product_id,
      currentStock: supplierProduct.stock,
      onlineSoldQty: onlineSold,
      offlineSoldQty: offlineSold,
      movements: movements || []
    });
  } catch (error) {
    console.error('Supplier inventory history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Manual inventory adjustment for a specific supplier_product
router.post('/inventory/adjust', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierInventoryAdjustSchema, req.body || {});
    const { supplier_product_id, product_id, quantity_change, reason } = payloadInput;

    // Ensure the supplier_product belongs to this supplier
    const { data: supplierProduct, error: spError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, attributes, product:products (id, brand)')
      .eq('id', supplier_product_id)
      .single();

    if (spError || !supplierProduct || supplierProduct.supplier_id !== req.userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Inventory entry not found for this supplier'
      });
    }

    // Brand lock: inventory changes should only apply to declared brands (when set)
    const brandCandidate =
      supplierProduct?.attributes?.brandModel ||
      supplierProduct?.product?.brand ||
      '';
    const brandGuard = brandIsAllowedForSupplier(req.user?.profile, brandCandidate);
    if (!brandGuard.allowed) {
      return res.status(403).json({
        status: 'error',
        message: 'You can only adjust inventory for brands you selected in your profile.',
        allowedBrands: brandGuard.declared || []
      });
    }

    const qtyChange = parseInt(quantity_change);
    if (!qtyChange || qtyChange === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'quantity_change must be a non-zero integer'
      });
    }

    await recordInventoryMovement({
      supplierProductId: supplier_product_id,
      supplierId: req.userId,
      productId: product_id,
      quantityChange: qtyChange,
      movementType: 'adjustment',
      referenceOrderId: null,
      referenceOrderItemId: null,
      notes: reason || 'Manual adjustment',
      userId: req.userId
    });

    res.json({
      status: 'success',
      message: 'Inventory adjustment recorded successfully'
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Supplier inventory adjust error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Sales by channel analytics for the logged-in supplier
router.get('/analytics/sales-by-channel', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const { from, to } = req.query;

    // 1) Fetch orders for this supplier
    let ordersQuery = supabase
      .from('orders')
      .select('id, channel, total_amount, created_at, payment_status')
      .eq('supplier_id', supplierId);

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery;
    if (ordersError) {
      throw ordersError;
    }

    const recognizedOrders = (orders || []).filter((o) => isRevenueRecognizedOrder(o));
    const orderIds = recognizedOrders.map((o) => o.id);
    if (orderIds.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalRevenue: 0,
          totalOrders: 0,
          channels: []
        },
        products: []
      });
    }

    // 2) Fetch order_items for these orders
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, unit_price, total_price')
      .in('order_id', orderIds);
    const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
      supabase,
      orderIds
    );


    if (itemsError) {
      throw itemsError;
    }

    // 3) Fetch product names for reporting
    const productIds = [...new Set((orderItems || []).map(i => i.product_id).filter(Boolean))];
    let productsMap = {};
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, category')
        .in('id', productIds);
      (products || []).forEach(p => { productsMap[p.id] = p; });
    }

    const ordersById = {};
    recognizedOrders.forEach(o => { ordersById[o.id] = o; });

    // 4) Aggregate by channel and product
    const channelAgg = {};
    const productAgg = {};
    let totalRevenue = 0;

    (orderItems || []).forEach(item => {
      const order = ordersById[item.order_id];
      if (!order) return;
      const channel = order.channel || 'unknown';

      const metrics = getNetItemMetrics(item, closedReturnedQtyByOrderItem);
      const qty = metrics.netQty;
      const revenue = metrics.netRevenue;
      if (qty <= 0 || revenue <= 0) return;

      totalRevenue += revenue;

      // Channel-level
      if (!channelAgg[channel]) {
        channelAgg[channel] = { channel, revenue: 0, quantity: 0, orderCount: 0 };
      }
      channelAgg[channel].revenue += revenue;
      channelAgg[channel].quantity += qty;
      channelAgg[channel].orderCount += 1;

      // Product-level
      const pid = item.product_id || 'unknown';
      if (!productAgg[pid]) {
        const p = productsMap[pid] || {};
        productAgg[pid] = {
          productId: pid,
          name: p.name || 'Unknown Product',
          category: p.category || null,
          onlineQty: 0,
          offlineQty: 0,
          onlineRevenue: 0,
          offlineRevenue: 0,
          totalQty: 0,
          totalRevenue: 0
        };
      }
      const rec = productAgg[pid];
      const isOffline = channel === 'offline_sale';

      rec.totalQty += qty;
      rec.totalRevenue += revenue;
      if (isOffline) {
        rec.offlineQty += qty;
        rec.offlineRevenue += revenue;
      } else {
        rec.onlineQty += qty;
        rec.onlineRevenue += revenue;
      }
    });

    const channels = Object.values(channelAgg).map(c => ({
      ...c,
      revenue: c.revenue,
      quantity: c.quantity
    }));

    const products = Object.values(productAgg)
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 50);

    res.json({
      status: 'success',
      summary: {
        totalRevenue,
        totalOrders: recognizedOrders.length,
        channels
      },
      products
    });
  } catch (error) {
    console.error('Supplier sales-by-channel analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Purchase-focused analytics for supplier portal:
// what supplier purchases from upstream partners, brand-wise totals.
router.get('/analytics/discount-insights', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();

    let ordersQuery = supabase
      .from('orders')
      .select('id, total_amount, supplier_id, status, payment_status, channel')
      .eq('service_provider_id', supplierId)
      .eq('channel', 'b2b_po');

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery;

    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    const orderIds = ordersList.map((order) => order.id).filter(Boolean);

    if (orderIds.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalUpstreamSuppliers: 0,
          totalOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0
        },
        brands: []
      });
    }

    const uniqueUpstreamSupplierIds = new Set(
      ordersList.map((order) => order.supplier_id).filter(Boolean)
    );

    const totalPurchaseValue = ordersList.reduce(
      (sum, order) => sum + (parseFloat(order.total_amount || 0) || 0),
      0
    );
    const paidPurchaseOrderIds = new Set(
      ordersList
        .filter((order) => String(order.payment_status || '').toLowerCase() === 'paid')
        .map((order) => order.id)
        .filter(Boolean)
    );

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, order_id, quantity, unit_price, total_price, product_id, supplier_product_id')
      .in('order_id', orderIds);
    if (itemsError) {
      throw itemsError;
    }

    const itemsList = orderItems || [];
    const supplierProductIds = [
      ...new Set(itemsList.map((item) => item.supplier_product_id).filter(Boolean))
    ];
    const productIds = [...new Set(itemsList.map((item) => item.product_id).filter(Boolean))];

    let supplierProductById = new Map();
    if (supplierProductIds.length > 0) {
      const { data: supplierProducts } = await supabase
        .from('supplier_products')
        .select('id, attributes')
        .in('id', supplierProductIds);
      supplierProductById = new Map((supplierProducts || []).map((row) => [row.id, row]));
    }

    let productById = new Map();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, category')
        .in('id', productIds);
      productById = new Map((products || []).map((row) => [row.id, row]));
    }

    const brandAgg = new Map();

    for (const item of itemsList) {
      const supplierProduct = supplierProductById.get(item.supplier_product_id) || {};
      const product = productById.get(item.product_id) || {};
      const attrs = supplierProduct.attributes || {};

      const brandName =
        String(attrs.brandModel || attrs.brand || product.name || product.category || 'Unspecified')
          .trim() || 'Unspecified';
      const quantity = parseFloat(item.quantity || 0) || 0;
      const purchaseValue = parseFloat(item.total_price || 0) || 0;
      if (quantity <= 0 || purchaseValue <= 0) {
        continue;
      }

      if (!brandAgg.has(brandName)) {
        brandAgg.set(brandName, {
          brand: brandName,
          orderValue: 0,
          itemQty: 0
        });
      }

      const rec = brandAgg.get(brandName);
      rec.orderValue += purchaseValue;
      rec.itemQty += quantity;
    }

    const paidPurchaseValue = itemsList.reduce((sum, item) => {
      if (!paidPurchaseOrderIds.has(item.order_id)) {
        return sum;
      }
      return sum + (parseFloat(item.total_price || 0) || 0);
    }, 0);

    const brands = [...brandAgg.values()]
      .sort((a, b) => b.orderValue - a.orderValue)
      .slice(0, 20);

    return res.json({
      status: 'success',
      summary: {
        totalUpstreamSuppliers: uniqueUpstreamSupplierIds.size,
        totalOrders: ordersList.length,
        totalPurchaseValue,
        paidPurchaseValue
      },
      brands
    });
  } catch (error) {
    console.error('Supplier discount insights analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Buyer-wise purchase tracking for supplier portal.
router.get('/analytics/upstream-supplier-purchase-totals', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({
        status: 'error',
        message: 'Only suppliers can view upstream purchase totals'
      });
    }

    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const top = parseInt(req.query?.top, 10);

    let ordersQuery = supabase
      .from('orders')
      .select('id, supplier_id, total_amount, status, payment_status, created_at')
      .eq('service_provider_id', req.userId)
      .eq('channel', 'b2b_po');

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery.order('created_at', { ascending: false });
    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    if (ordersList.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalSuppliers: 0,
          totalOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0
        },
        suppliers: []
      });
    }

    const upstreamSupplierIds = [
      ...new Set(ordersList.map((order) => order.supplier_id).filter(Boolean))
    ];
    let suppliersById = new Map();
    if (upstreamSupplierIds.length > 0) {
      const { data: suppliersData } = await supabase
        .from('users')
        .select('id, name, company, email')
        .in('id', upstreamSupplierIds);
      suppliersById = new Map((suppliersData || []).map((supplier) => [supplier.id, supplier]));
    }

    const supplierAgg = new Map();
    for (const order of ordersList) {
      const upstreamSupplierId = order.supplier_id || 'unknown';
      if (!supplierAgg.has(upstreamSupplierId)) {
        const supplier = suppliersById.get(upstreamSupplierId) || {};
        supplierAgg.set(upstreamSupplierId, {
          supplierId: upstreamSupplierId,
          name: supplier.name || supplier.company || 'Unknown Supplier',
          company: supplier.company || null,
          email: supplier.email || null,
          totalOrders: 0,
          paidOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0,
          lastOrderAt: null
        });
      }

      const rec = supplierAgg.get(upstreamSupplierId);
      const orderValue = parseFloat(order.total_amount || 0) || 0;
      rec.totalOrders += 1;
      rec.totalPurchaseValue += orderValue;

      if (String(order.payment_status || '').toLowerCase() === 'paid') {
        rec.paidOrders += 1;
        rec.paidPurchaseValue += orderValue;
      }

      const createdTs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const prevTs = rec.lastOrderAt ? new Date(rec.lastOrderAt).getTime() : 0;
      if (createdTs > prevTs) {
        rec.lastOrderAt = order.created_at || null;
      }
    }

    const suppliers = [...supplierAgg.values()].sort(
      (a, b) => b.totalPurchaseValue - a.totalPurchaseValue
    );
    const normalizedTop = Number.isFinite(top) && top > 0 ? Math.min(top, 500) : null;
    const suppliersSlice = normalizedTop ? suppliers.slice(0, normalizedTop) : suppliers;

    return res.json({
      status: 'success',
      summary: {
        totalSuppliers: suppliersSlice.length,
        totalOrders: suppliersSlice.reduce((sum, supplier) => sum + supplier.totalOrders, 0),
        totalPurchaseValue: suppliersSlice.reduce(
          (sum, supplier) => sum + supplier.totalPurchaseValue,
          0
        ),
        paidPurchaseValue: suppliersSlice.reduce(
          (sum, supplier) => sum + supplier.paidPurchaseValue,
          0
        )
      },
      suppliers: suppliersSlice
    });
  } catch (error) {
    console.error('Supplier upstream purchase totals analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Buyer-wise purchase tracking for supplier portal.
router.get('/analytics/buyer-purchases', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const top = parseInt(req.query?.top, 10);

    let ordersQuery = supabase
      .from('orders')
      .select('id, service_provider_id, total_amount, status, payment_status, created_at')
      .eq('supplier_id', supplierId);

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery.order('created_at', { ascending: false });

    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    if (ordersList.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalBuyers: 0,
          totalOrders: 0,
          totalOrderValue: 0,
          totalNetRevenue: 0
        },
        buyers: []
      });
    }

    const recognizedOrders = ordersList.filter((order) => isRevenueRecognizedOrder(order));
    const recognizedOrderIds = recognizedOrders.map((order) => order.id).filter(Boolean);

    let orderNetRevenueById = new Map();
    if (recognizedOrderIds.length > 0) {
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('id, order_id, quantity, unit_price, total_price')
        .in('order_id', recognizedOrderIds);

      if (itemsError) {
        throw itemsError;
      }

      const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
        supabase,
        recognizedOrderIds
      );
      orderNetRevenueById = buildOrderNetRevenueMap(orderItems || [], closedReturnedQtyByOrderItem);
    }

    const buyerIds = [
      ...new Set(ordersList.map((order) => order.service_provider_id).filter(Boolean))
    ];
    let buyersById = new Map();
    if (buyerIds.length > 0) {
      const { data: buyersData } = await supabase
        .from('users')
        .select('id, name, company, email')
        .in('id', buyerIds);
      buyersById = new Map((buyersData || []).map((buyer) => [buyer.id, buyer]));
    }

    const buyerAgg = new Map();
    for (const order of ordersList) {
      const buyerId = order.service_provider_id || 'unknown';
      if (!buyerAgg.has(buyerId)) {
        const buyer = buyersById.get(buyerId) || {};
        buyerAgg.set(buyerId, {
          buyerId,
          name: buyer.name || buyer.company || 'Unknown Buyer',
          company: buyer.company || null,
          email: buyer.email || null,
          totalOrders: 0,
          paidOrders: 0,
          totalOrderValue: 0,
          netRevenue: 0,
          lastOrderAt: null
        });
      }

      const rec = buyerAgg.get(buyerId);
      rec.totalOrders += 1;
      rec.totalOrderValue += parseFloat(order.total_amount || 0) || 0;

      if (isRevenueRecognizedOrder(order)) {
        rec.paidOrders += 1;
        rec.netRevenue += orderNetRevenueById.get(order.id) || 0;
      }

      const createdTs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const prevTs = rec.lastOrderAt ? new Date(rec.lastOrderAt).getTime() : 0;
      if (createdTs > prevTs) {
        rec.lastOrderAt = order.created_at || null;
      }
    }

    const buyers = [...buyerAgg.values()].sort((a, b) => b.totalOrderValue - a.totalOrderValue);
    const normalizedTop = Number.isFinite(top) && top > 0 ? Math.min(top, 500) : null;
    const buyersSlice = normalizedTop ? buyers.slice(0, normalizedTop) : buyers;
    const summary = {
      totalBuyers: buyersSlice.length,
      totalOrders: ordersList.length,
      totalOrderValue: buyersSlice.reduce((sum, buyer) => sum + buyer.totalOrderValue, 0),
      totalNetRevenue: buyersSlice.reduce((sum, buyer) => sum + buyer.netRevenue, 0)
    };

    return res.json({
      status: 'success',
      summary,
      buyers: buyersSlice
    });
  } catch (error) {
    console.error('Supplier buyer purchases analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get single order details
router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    console.log(`[Supplier Order Details] Fetching order details for ID: ${decodedId}, User: ${req.userId} (type: ${typeof req.userId})`);
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          product:products (id, name, category, unit, price, description, location, specifications)
        ),
        boq:boqs (id, name)
      `)
      .eq('order_number', decodedId)
      .eq('supplier_id', req.userId)
      .single();
    
    if (orderError) {
      console.log(`[Supplier Order Details] Error finding by order_number:`, orderError);
    } else if (order) {
      console.log(`[Supplier Order Details] Found order by order_number: ${order.id}`);
    }
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      console.log(`[Supplier Order Details] Trying to find by ID: ${decodedId}`);
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (id, name, category, unit, price, description, location, specifications)
          ),
          boq:boqs (id, name)
        `)
        .eq('id', decodedId)
        .eq('supplier_id', req.userId)
        .single();
      
      if (orderByIdError) {
        console.log(`[Supplier Order Details] Error finding by id:`, orderByIdError);
      }
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
        console.log(`[Supplier Order Details] Found order by id: ${order.id}`);
      }
    }
    
    if (orderError || !order) {
      console.log(`[Supplier Order Details] Order not found: ${decodedId} for user ${req.userId}`);
      // Debug: Check if order exists for any supplier
      const { data: anyOrder, count } = await supabase
        .from('orders')
        .select('id, order_number, supplier_id', { count: 'exact' })
        .or(`order_number.eq.${decodedId},id.eq.${decodedId}`);
      console.log(`[Supplier Order Details] Debug: Found ${count || 0} orders with ID/order_number ${decodedId}`);
      if (anyOrder && anyOrder.length > 0) {
        console.log(`[Supplier Order Details] Debug: Order exists but supplier_id mismatch:`, {
          order_supplier_id: anyOrder[0].supplier_id,
          request_user_id: req.userId,
          match: anyOrder[0].supplier_id === req.userId
        });
      }
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to view this order' 
      });
    }
    
    console.log(`[Supplier Order Details] Order found: ${order.id}, service_provider_id: ${order.service_provider_id}`);
    
    // Fetch service provider separately
    let serviceProvider = null;
    if (order.service_provider_id) {
      const { data: serviceProviderData, error: serviceProviderError } = await supabase
        .from('users')
        .select('id, name, company, email, phone, address, user_type')
        .eq('id', order.service_provider_id)
        .single();
      
      if (serviceProviderError) {
        console.error(`[Supplier Order Details] Error fetching service provider:`, serviceProviderError);
      } else {
        serviceProvider = {
          ...serviceProviderData,
          address: normalizeUserAddress(serviceProviderData?.address || {})
        };
        console.log(`[Supplier Order Details] Service provider fetched:`, serviceProvider?.name || serviceProvider?.company || 'N/A');
      }
    } else {
      console.log(`[Supplier Order Details] No service_provider_id in order`);
    }
    
    // Format order for frontend.
    // Use immutable order snapshot fields so placed orders never drift with later edits.
    const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
    order.order_items = orderItems.map((it) => {
      let snapshot = {};
      if (it?.specifications && typeof it.specifications === 'object') {
        snapshot = it.specifications;
      } else if (typeof it?.specifications === 'string') {
        try {
          snapshot = JSON.parse(it.specifications);
        } catch {
          snapshot = {};
        }
      }
      const variantAttributes =
        snapshot?.variantAttributes && typeof snapshot.variantAttributes === 'object'
          ? snapshot.variantAttributes
          : {};

      return {
        ...it,
        unitPrice: parseFloat(it?.unit_price ?? it?.unitPrice ?? 0) || 0,
        totalPrice: parseFloat(it?.total_price ?? it?.totalPrice ?? 0) || 0,
        variantKey: snapshot?.variantKey || null,
        variantAsin: snapshot?.variantAsin || null,
        productTrackingId:
          snapshot?.variantAsin ||
          null,
        brandModel: snapshot?.brandModel ?? variantAttributes?.brandModel ?? null
      };
    });

    // Attach invoice + PDF URL (if invoice PDF was generated after payment)
    let invoice = null;
    try {
      const { data: invoiceRow } = await supabase
        .from('invoices')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      invoice = invoiceRow || null;
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch invoice:', e);
    }
    let receipt = null;
    try {
      const { data: receiptRow } = await supabase
        .from('payment_receipts')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      receipt = receiptRow || null;
      if (receipt && !receipt?.metadata?.pdfUrl) {
        const backfilled = await generateAndAttachReceiptPdf({
          receipt,
          order,
          supplier: { id: req.userId, name: 'Supplier' },
          serviceProvider
        });
        receipt = backfilled?.receipt || receipt;
      }
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch receipt:', e);
    }

    let returns = [];
    try {
      const { data: returnRows } = await supabase
        .from('order_returns')
        .select('*')
        .eq('order_id', order.id)
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false });
      returns = returnRows || [];
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch returns:', e);
    }

    const formattedOrder = {
      ...order,
      orderNumber: order.order_number || order.id,
      totalAmount: parseFloat(order.total_amount || 0),
      paymentStatus: order.payment_status || 'pending',
      paymentMethod: order.payment_method,
      status: order.status || 'pending',
      createdAt: order.created_at,
      updatedAt: order.updated_at || order.created_at,
      channel: order.channel || null,
      statusHistory: Array.isArray(order.status_history) ? order.status_history : [],
      trackingNumber: order.tracking_number || null,
      trackingUrl: order.tracking_url || null,
      shippingProvider: order.shipping_provider || null,
      expectedDeliveryDate: order.expected_delivery_date,
      actualDeliveryDate: order.actual_delivery_date,
      deliveryAddress: order.delivery_address,
      items: order.order_items || [],
      serviceProvider: serviceProvider,
      boq: order.boq || null,
      invoice: invoice,
      invoicePdfUrl: invoice?.metadata?.pdfUrl || null,
      receipt: receipt,
      receiptPdfUrl: receipt?.metadata?.pdfUrl || null,
      returns
    };
    
    console.log(`[Supplier Order Details] Returning order details for: ${formattedOrder.orderNumber}`);
    
    res.json({ 
      status: 'success',
      order: formattedOrder
    });
  } catch (error) {
    console.error('[Supplier Order Details] Get supplier order details error:', error);
    console.error('[Supplier Order Details] Error stack:', error.stack);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// List return requests for current supplier
router.get('/returns', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('order_returns')
      .select('*')
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supplier Returns] list error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to fetch return requests' });
    }

    return res.json({ status: 'success', returns: data || [] });
  } catch (error) {
    console.error('[Supplier Returns] list exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update return status (supplier workflow)
router.patch('/returns/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payloadInput = parseWithSchema(supplierReturnStatusPatchSchema, req.body || {});
    const { status, supplierNotes } = payloadInput;

    const { data: existing } = await supabase
      .from('order_returns')
      .select('*')
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Return request not found' });
    }

    const history = Array.isArray(existing.status_history) ? existing.status_history : [];
    history.push({
      status,
      by: req.userId,
      note: supplierNotes || '',
      at: new Date().toISOString()
    });

    const closingNow = status === 'closed' && existing.status !== 'closed';
    const prevMeta =
      existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    const metadataPatch = closingNow
      ? { ...prevMeta, supplier_closed_at: new Date().toISOString() }
      : prevMeta;

    const { data: updated, error: updateErr } = await supabase
      .from('order_returns')
      .update({
        status,
        supplier_notes: supplierNotes || existing.supplier_notes || null,
        status_history: history,
        ...(closingNow ? { metadata: metadataPatch } : {})
      })
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .select('*')
      .single();

    if (updateErr) {
      console.error('[Supplier Returns] update error:', updateErr);
      return res.status(500).json({ status: 'error', message: 'Failed to update return status' });
    }

    // For upstream chain orders (supplier buyer -> supplier seller), restock immediately on close.
    // For non-supplier buyers, keep acknowledgement-driven flow from buyer portal.
    let buyerIsSupplier = false;
    if (closingNow) {
      try {
        const { data: buyerUser } = await supabase
          .from('users')
          .select('id, user_type')
          .eq('id', existing.service_provider_id)
          .maybeSingle();
        buyerIsSupplier = String(buyerUser?.user_type || '').toLowerCase() === 'supplier';

        if (buyerIsSupplier) {
          const restock = await applyRestockForClosedReturn(updated, req.userId);
          if (restock.ok && !restock.skipped && !restock.already) {
            console.log('[Supplier Returns] upstream return restocked on close', {
              returnId: existing.id,
              qtyToAdd: restock.qtyToAdd
            });
          }
        }
      } catch (restockErr) {
        console.error('[Supplier Returns] upstream auto-restock failed:', restockErr);
      }
    }

    // Notify service provider
    try {
      const message = closingNow
        ? buyerIsSupplier
          ? `Your return request for order ${existing.order_id} is now ${status}. Inventory has been finalized automatically for this upstream return.`
          : `Your return request for order ${existing.order_id} is now ${status}. Please confirm return completion under My Returns so inventory can be finalized.`
        : `Your return request for order ${existing.order_id} is now ${status}.`;
      await insertNotification({
        user_id: existing.service_provider_id,
        type: 'order_return_status_updated',
        title: `Return ${status.replace('_', ' ')}`,
        message,
        related_order_id: existing.order_id,
        is_read: false,
        metadata: { returnId: existing.id, status }
      }, supabase);
    } catch (notifErr) {
      console.error('[Supplier Returns] notification error:', notifErr);
    }

    return res.json({ status: 'success', returnRequest: updated });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Supplier Returns] update exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update order status (and optional tracking info for shipments)
router.patch('/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierOrderStatusPatchSchema, req.body || {});
    const { status, notes, shippingProvider, trackingNumber, trackingUrl } = payloadInput;
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    console.log(`Updating order status for ID: ${decodedId}, Status: ${status}, User: ${req.userId}`);
    
    if (!status) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Status is required' 
      });
    }
    
    // Validate status
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!isValidPrimaryOrderStatus(normalizedStatus)) {
      return res.status(400).json({ 
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('supplier_id', req.userId)
      .single();
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('supplier_id', req.userId)
        .single();
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }
    
    if (orderError || !order) {
      logger.debug(`Order not found for status update: ${decodedId} for user ${req.userId}`);
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to update this order' 
      });
    }

    const previousStatus = String(order.status || '');
    
    // Get current status history
    const statusHistory = order.status_history || [];
    
    // Record the NEW status event in history (so timeline matches the displayed status)
    statusHistory.push({
      status: normalizedStatus,
      updatedBy: req.userId,
      notes: notes || `Status updated to ${normalizedStatus}`,
      timestamp: new Date().toISOString()
    });
    
    // Update status
    const updatePayload = { 
      status: normalizedStatus,
      lifecycle_state: toLifecycleStateFromStatus(normalizedStatus),
      status_history: statusHistory
    };

    // Arrival tracking: set actual delivery date when supplier marks delivered
    if (normalizedStatus === 'delivered') {
      updatePayload.actual_delivery_date = new Date().toISOString();
    }

    // Allow supplier to attach/update tracking info (mainly when marking as shipped)
    if (typeof shippingProvider === 'string') {
      updatePayload.shipping_provider = shippingProvider || null;
    }
    if (typeof trackingNumber === 'string') {
      updatePayload.tracking_number = trackingNumber || null;
    }
    if (typeof trackingUrl === 'string') {
      updatePayload.tracking_url = trackingUrl || null;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id)
      .select(`
        *,
        service_provider:users!orders_service_provider_id_fkey (id, name, company, email, phone, address),
        order_items (
          *,
          product:products (id, name, category, unit, price, description, location, specifications)
        ),
        boq:boqs (id, name)
      `)
      .single();
    
    if (updateError) {
      logger.error('Update error:', updateError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update order status'
      });
    }

    // If supplier cancels an order, restore their inventory (seller stock) for all line items.
    // We do it after successful status update and prevent double-restock using inventory_movements.
    if (normalizedStatus === 'cancelled' && previousStatus !== 'cancelled') {
      try {
        const { data: existingRestock } = await supabase
          .from('inventory_movements')
          .select('id')
          .eq('reference_order_id', order.id)
          .eq('movement_type', 'adjustment')
          .ilike('notes', '%cancel_restock%')
          .limit(1);

        const already = existingRestock && existingRestock.length > 0;
        if (!already) {
          const { data: items } = await supabase
            .from('order_items')
            .select('id, product_id, supplier_product_id, quantity')
            .eq('order_id', order.id);

          for (const it of items || []) {
            const qty = parseFloat(it.quantity || 0) || 0;
            if (!qty || qty <= 0) continue;
            if (!it.supplier_product_id) continue;

            await recordInventoryMovement({
              supplierProductId: it.supplier_product_id,
              supplierId: order.supplier_id,
              productId: it.product_id,
              quantityChange: Math.round(qty),
              movementType: 'adjustment',
              referenceOrderId: order.id,
              referenceOrderItemId: it.id,
              notes: 'cancel_restock: inventory added back due to order cancellation',
              userId: req.userId
            });
          }
        }
      } catch (e) {
        logger.error('[Supplier Cancel] inventory restock failed:', e);
      }
    }
    
    logger.info(`Order status updated successfully: ${updatedOrder.order_number} to ${normalizedStatus}`);

    // Notify the buyer (service_provider / chain partner) so upstream orders are trackable from their portal.
    const buyerId = updatedOrder.service_provider_id;
    if (buyerId && buyerId !== req.userId) {
      try {
        await insertNotification({
          user_id: buyerId,
          type: 'order_status',
          title: `Order ${updatedOrder.order_number} — ${normalizedStatus}`,
          message: `Your supplier updated the order status to "${normalizedStatus}".`,
          related_order_id: updatedOrder.id,
          is_read: false,
          metadata: {
            orderNumber: updatedOrder.order_number,
            previousStatus: previousStatus,
            newStatus: normalizedStatus,
            supplierId: req.userId
          }
        }, supabase);
      } catch (notifErr) {
        logger.error('[Supplier Order Status] buyer notification error:', notifErr);
      }
    }
    
    res.json({ 
      status: 'success',
      message: 'Order status updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update order status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// Get notifications for supplier
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, unreadOnly = false } = req.query;
    
    let query = supabase
      .from('notifications')
      .select(`
        *,
        related_order:orders!notifications_related_order_id_fkey (order_number, total_amount)
      `)
      .eq('user_id', req.userId);
    
    if (unreadOnly === 'true') {
      query = query.eq('is_read', false);
    }
    
    query = query.order('created_at', { ascending: false })
      .limit(parseInt(limit));
    
    const { data: notifications, error } = await query;
    
    if (error) {
      throw error;
    }
    
    // Get unread count
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .eq('is_read', false);
    
    res.json({ 
      status: 'success',
      notifications: notifications || [],
      unreadCount: unreadCount || 0
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Mark notification as read
router.patch('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierNotificationReadSchema, req.body || {});
    const { data: notification, error } = await supabase
      .from('notifications')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    
    if (error || !notification) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Notification not found' 
      });
    }
    
    res.json({ 
      status: 'success',
      message: 'Notification marked as read',
      notification 
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Mark notification as read error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Mark all notifications as read
router.patch('/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(supplierNotificationReadSchema, req.body || {});
    const { error } = await supabase
      .from('notifications')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('user_id', req.userId)
      .eq('is_read', false);
    
    if (error) {
      throw error;
    }
    
    res.json({ 
      status: 'success',
      message: 'All notifications marked as read'
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// AI-assisted supplier onboarding: prefill values only against admin-defined keys.
router.post('/products/ai-enhance', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierProductAiEnhanceSchema, req.body || {});
    const { category, familyId, specifications = {}, provider = 'manual' } = payloadInput;
    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'category is required'
      });
    }

    const { template, fields } = await loadSpecTemplateForCategory(category, familyId || null);
    if (!template || fields.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No active specification template found for this category/model'
      });
    }

    const validated = validateSpecValues(fields, specifications || {});
    const identityBundle = buildIdentityBundle({
      name: payloadInput.name || '',
      category,
      brand: payloadInput.brand || '',
      gtin: payloadInput.gtin || '',
      mpn: payloadInput.mpn || '',
      specifications: validated.allowed
    });
    const confidenceScore = scoreOnboardingConfidence({
      identityBundle,
      validationErrors: validated.errors,
      unknownKeys: validated.unknownKeys
    });
    const decision = decideOnboardingAction(confidenceScore, onboardingAutoApproveThreshold);

    const fieldSkeleton = {};
    for (const field of fields) {
      const key = (field.field_key || '').toString().trim();
      if (!key) continue;
      fieldSkeleton[key] = validated.allowed[key] ?? null;
    }

    await supabase.from('product_ingestion_runs').insert({
      supplier_id: req.userId,
      provider: ['gemini', 'openai', 'claude'].includes(provider) ? provider : 'manual',
      model: provider === 'manual' ? 'supplier_prefill' : provider,
      prompt_version: 'v1',
      input_payload: { category, familyId: familyId || null, specifications },
      extracted_payload: specifications || {},
      validated_payload: fieldSkeleton,
      confidence_score: confidenceScore,
      validation_errors: validated.errors || [],
      final_decision: decision,
      actor_id: req.userId
    });

    res.json({
      status: 'success',
      template: {
        id: template.id,
        name: template.name,
        category: template.category
      },
      specifications: fieldSkeleton,
      unknownKeys: validated.unknownKeys,
      validationErrors: validated.errors,
      confidenceScore,
      recommendedAction: decision
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Supplier AI enhance error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to generate AI specification prefill'
    });
  }
});

// Extract specification keys from admin template; supplier fills only values.
router.post('/products/extract-specifications', authenticateToken, async (req, res) => {
  try {
    const { category, familyId } = parseWithSchema(supplierProductExtractSpecificationsSchema, req.body || {});
    if (!category) {
      return res.status(400).json({
        status: 'error',
        message: 'category is required'
      });
    }

    const { template, fields } = await loadSpecTemplateForCategory(category, familyId || null);
    if (!template || fields.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No active specification template found for this category/model'
      });
    }

    const specifications = {};
    const schema = [];
    for (const field of fields) {
      const key = (field.field_key || '').toString().trim();
      if (!key) continue;
      specifications[key] = null;
      schema.push({
        key,
        displayName: field.display_name,
        dataType: field.data_type,
        isRequired: !!field.is_required,
        enumValues: field.enum_values || [],
        allowedUnits: field.allowed_units || [],
        minValue: field.min_value,
        maxValue: field.max_value
      });
    }

    res.json({
      status: 'success',
      template: {
        id: template.id,
        name: template.name,
        category: template.category
      },
      specifications,
      schema
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Extract specifications error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to load specification template'
    });
  }
});

// Analyze product images to extract product name and category (min 3 images for reliable vision)
router.post('/products/analyze-image', authenticateToken, async (req, res) => {
  try {
    const { images, imageBase64, imageUrl, provider = 'auto' } = parseWithSchema(
      supplierProductAnalyzeImageSchema,
      req.body || {}
    );

    const MIN_IMAGES = 3;

    /** @type {{ base64: string, mimeType: string }[]} */
    let visionImages = [];

    if (Array.isArray(images) && images.length > 0) {
      visionImages = images
        .map((img) => {
          const raw = img?.data ?? img?.base64 ?? img?.imageBase64;
          const mimeType = (img?.mimeType || img?.mime || 'image/jpeg').toString();
          if (!raw || typeof raw !== 'string') return null;
          return { base64: raw.replace(/^data:image\/\w+;base64,/, ''), mimeType };
        })
        .filter(Boolean);

      if (visionImages.length < MIN_IMAGES) {
        return res.status(400).json({
          status: 'error',
          message: `Please upload at least ${MIN_IMAGES} product photos (different angles or details — e.g. front, side, label) so AI can identify the product reliably.`
        });
      }
    } else if (imageBase64 || imageUrl) {
      return res.status(400).json({
        status: 'error',
        message: `Please upload at least ${MIN_IMAGES} product photos instead of one. Multiple angles help AI detect name and category accurately.`
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'No images provided. Add at least 3 product photos.'
      });
    }

    // Get API keys from environment variables
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    // Determine which provider to use
    let selectedProvider = provider;
    if (provider === 'auto') {
      // Auto-select: prioritize Gemini > OpenAI > Claude
      if (geminiApiKey) selectedProvider = 'gemini';
      else if (openaiApiKey) selectedProvider = 'openai';
      else if (anthropicApiKey) selectedProvider = 'claude';
      else {
        return res.status(400).json({
          status: 'error',
          message: 'No AI API keys configured. Please set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in environment variables.'
        });
      }
    }

    // Validate API key for selected provider
    if (selectedProvider === 'openai' && !openaiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.'
      });
    }
    if (selectedProvider === 'gemini' && !geminiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.'
      });
    }
    if (selectedProvider === 'claude' && !anthropicApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Claude API key not configured. Please set ANTHROPIC_API_KEY in environment variables.'
      });
    }

    // Initialize fetch
    let fetch;
    try {
      if (typeof globalThis.fetch === 'function') {
        fetch = globalThis.fetch;
      } else {
        const nodeFetch = await import('node-fetch');
        fetch = nodeFetch.default;
      }
    } catch (error) {
      console.error('Failed to load fetch:', error);
      throw new Error('Fetch API not available');
    }

    // Optionally load existing categories only to give AI examples (not to restrict it)
    const { data: categories } = await supabase
      .from('categories')
      .select('name, display_name')
      .eq('is_active', true);
    
    const categoryExamples = (categories || []).map(cat => cat.display_name || cat.name).join(', ');

    // Build prompt for vision AI (multiple images of the same product).
    const prompt = `You are given ${visionImages.length} photos of the SAME construction / building material product (different angles or details). Analyze them together and identify:
1. Product Name: A clear, concise product name (e.g., "Portland Cement OPC 53", "TMT Steel Bar 12mm", "Red Clay Brick")
2. Category: A short category name describing this construction material (for example: ${categoryExamples || 'steel, cement, aggregates, masonry, electrical, plumbing, hardware'}).

IMPORTANT:
- Use ALL images together — labels, texture, shape, and packaging may appear in different shots
- The product name should be specific and professional (include brand/model if visible, dimensions if applicable)
- The category should be concise and reusable for grouping similar products (1–3 words)
- You MAY reuse one of the example categories or output a NEW category if it fits better
- Return ONLY valid JSON with no additional text

Return this JSON structure:
{
  "productName": "exact product name inferred from the images",
  "category": "one of the categories from the list"
}`;

    let aiResponse;
    let result;

    // Call the appropriate AI provider with vision capabilities
    if (selectedProvider === 'openai') {
      const userContent = [
        { type: 'text', text: prompt },
        ...visionImages.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        }))
      ];

      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      const response = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that analyzes product images for construction materials. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: userContent
            }
          ],
          max_tokens: 300
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('OpenAI Vision API error:', errorData);
        throw new Error('OpenAI Vision API service unavailable');
      }

      const data = await response.json();
      aiResponse = data.choices?.[0]?.message?.content?.trim();
      
      if (!aiResponse) {
        throw new Error('No response from OpenAI Vision API');
      }

    } else if (selectedProvider === 'gemini') {
      const configuredGeminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-pro').trim();
      const modelCandidates = [
        { name: configuredGeminiModel, apiVersion: 'v1beta' },
        { name: `models/${configuredGeminiModel}`, apiVersion: 'v1beta' },
        { name: 'gemini-2.5-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-2.5-flash', apiVersion: 'v1beta' },
        { name: 'gemini-2.0-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-2.0-flash', apiVersion: 'v1beta' },
        { name: 'gemini-1.5-flash', apiVersion: 'v1beta' },
        { name: 'models/gemini-1.5-flash', apiVersion: 'v1beta' },
        { name: 'gemini-1.5-flash', apiVersion: 'v1' },
        { name: 'models/gemini-1.5-flash', apiVersion: 'v1' }
      ].filter((c, idx, arr) =>
        c.name && arr.findIndex((x) => x.name === c.name && x.apiVersion === c.apiVersion) === idx
      );

      const geminiParts = [{ text: prompt }];
      for (const img of visionImages) {
        geminiParts.push({
          inline_data: {
            mime_type: img.mimeType.includes('/') ? img.mimeType : 'image/jpeg',
            data: img.base64
          }
        });
      }

      let lastGeminiReason = '';
      for (const candidate of modelCandidates) {
        const geminiModel = candidate.name;
        const apiVersion = candidate.apiVersion || 'v1beta';
        const geminiUrl = geminiModel.startsWith('models/')
          ? `https://generativelanguage.googleapis.com/${apiVersion}/${geminiModel}:generateContent?key=${geminiApiKey}`
          : `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: geminiParts
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json'
            }
          })
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error(`Gemini Vision API error (${geminiModel}, ${apiVersion}):`, errorData);
          lastGeminiReason = `HTTP ${response.status}`;
          continue;
        }

        const data = await response.json();
        const finishReason = data?.candidates?.[0]?.finishReason || '';
        const blockReason = data?.promptFeedback?.blockReason || '';
        const safety = Array.isArray(data?.candidates?.[0]?.safetyRatings)
          ? data.candidates[0].safetyRatings.map((s) => `${s.category}:${s.probability}`).join(', ')
          : '';
        const textFromParts = (data?.candidates || [])
          .flatMap((c) => c?.content?.parts || [])
          .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
          .find(Boolean);

        // Skip partial/non-JSON Gemini outputs and try next fallback model.
        // Example observed output: "Here is the JSON requested:" with no JSON body.
        const cleanedText = String(textFromParts || '')
          .replace(/```json/gi, '```')
          .replace(/```/g, '')
          .trim();
        const looksLikeJsonPayload =
          (cleanedText.includes('{') && cleanedText.includes('}')) ||
          /["']?(productName|product_name|name|category|category_name)["']?\s*[:=]/i.test(cleanedText);
        const looksLikePartialPreamble =
          /^here\s+is\s+the\s+json\s+requested/i.test(cleanedText) && !cleanedText.includes('{');

        if (textFromParts && looksLikeJsonPayload && !looksLikePartialPreamble) {
          aiResponse = textFromParts;
          break;
        }

        lastGeminiReason = [blockReason, finishReason, safety].filter(Boolean).join(' | ');
        console.warn(`Gemini empty response (${geminiModel})`, {
          blockReason,
          finishReason,
          safety,
          preview: cleanedText.slice(0, 120)
        });
      }

      if (!aiResponse) {
        throw new Error(
          lastGeminiReason
            ? `No response from Gemini Vision API (${lastGeminiReason})`
            : 'No response from Gemini Vision API'
        );
      }

    } else if (selectedProvider === 'claude') {
      const claudeUrl = 'https://api.anthropic.com/v1/messages';
      const claudeMedia = (mime) =>
        mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp' ? mime : 'image/jpeg';

      const claudeContent = [
        ...visionImages.map((img) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: claudeMedia(img.mimeType),
            data: img.base64
          }
        })),
        { type: 'text', text: prompt }
      ];

      const response = await fetch(claudeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: claudeContent
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Claude Vision API error:', errorData);
        throw new Error('Claude Vision API service unavailable');
      }

      const data = await response.json();
      aiResponse = data.content?.[0]?.text?.trim();
      
      if (!aiResponse) {
        throw new Error('No response from Claude Vision API');
      }
    }

    // Parse AI response
    try {
      // If provider already returned an object, use it directly
      if (aiResponse && typeof aiResponse === 'object') {
        result = aiResponse;
      } else {
        const text = String(aiResponse || '').trim();
        const cleaned = text
          .replace(/```json/gi, '```')
          .replace(/```/g, '')
          .trim();

        // 1) Try direct JSON.parse on full text
        try {
          result = JSON.parse(cleaned);
        } catch {
          // 2) Try to extract the first JSON object from the text
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
          } else {
            // 3) Fallback: parse free-form key/value outputs
            const matchValue = (patterns) => {
              for (const p of patterns) {
                const m = cleaned.match(p);
                if (m?.[1]) return String(m[1]).trim();
              }
              return null;
            };

            const fallbackName = matchValue([
              /(?:^|\n)\s*["']?productName["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?product_name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*(?:Product\s*Name|Product)\s*[:=-]\s*(.+?)\s*(?:\n|$)/i
            ]);

            const fallbackCategory = matchValue([
              /(?:^|\n)\s*["']?category["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?categoryName["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*["']?category_name["']?\s*[:=]\s*["']?(.+?)["']?\s*(?:\n|$)/i,
              /(?:^|\n)\s*(?:Category)\s*[:=-]\s*(.+?)\s*(?:\n|$)/i
            ]);

            if (fallbackName || fallbackCategory) {
              result = {
                productName: fallbackName,
                category: fallbackCategory
              };
            } else {
              throw new Error('No JSON or recognizable productName/category fields in AI response');
            }
          }
        }
      }

      // Normalize common alternate keys from model outputs.
      if (!result?.productName && (result?.product_name || result?.name || result?.product)) {
        result.productName = result.product_name || result.name || result.product;
      }
      if (!result?.category && (result?.category_name || result?.categoryName || result?.productCategory)) {
        result.category = result.category_name || result.categoryName || result.productCategory;
      }

      if (result?.productName != null) result.productName = String(result.productName).trim();
      if (result?.category != null) result.category = String(result.category).trim();
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      console.error('Parse error details:', parseError);
      throw new Error('Failed to parse AI response as JSON');
    }

    res.json({
      status: 'success',
      productName: result.productName || null,
      // Do NOT force category to existing ones: allow new categories from AI.
      // The /products endpoint will auto-create the category if it doesn't exist.
      category: (result.category || '').trim() || null,
      provider: selectedProvider,
      rawResponse: result
    });

  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Image analysis error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to analyze image. Please try again.'
    });
  }
});

export { router as supplierRouter };
