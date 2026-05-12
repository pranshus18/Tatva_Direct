import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile } from '../services/storage.js';
import {
  baselineChainFromProfile,
  buildChainPayloadFromProfileData,
  chainPayloadSignature,
  clearPendingChainRequest,
  fetchLatestChainRequest,
  fetchPendingChainRequest,
  hasAnySupplyChainRole,
  normalizeCompanyInfoEntries,
  replacePendingChainRequest
} from '../services/supplierChainProfileService.js';
import { SUPPLY_CHAIN_ROLES_IN_ORDER, normalizeBrandKey } from '../services/supplyChainSharedService.js';
import { insertNotifications } from '../repositories/notificationsRepository.js';
import { findAdmins } from '../repositories/usersRepository.js';
import { profileUpdateSchema, profileUploadCertificateBodySchema } from '../contracts/profileContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const SERVICE_PROVIDER_THEME_IDS = new Set(['default', 'sunset', 'ocean', 'forest', 'city-lights', 'blueprint', 'custom']);
const MAX_THEME_IMAGE_DATA_URL_LENGTH = 3_500_000;
// ================= Brand approval helpers (global) =================

function sanitizeServiceProviderThemePrefs(rawTheme) {
  const themeId = String(rawTheme?.themeId || 'default').trim() || 'default';
  const safeThemeId = SERVICE_PROVIDER_THEME_IDS.has(themeId) ? themeId : 'default';
  const customImageDataUrl =
    safeThemeId === 'custom' ? String(rawTheme?.customImageDataUrl || '').trim() : '';
  if (customImageDataUrl.length > MAX_THEME_IMAGE_DATA_URL_LENGTH) {
    throw new Error('Custom wallpaper image is too large. Please upload a smaller image.');
  }
  if (customImageDataUrl && !customImageDataUrl.startsWith('data:image/')) {
    throw new Error('Custom wallpaper must be an image.');
  }
  return {
    themeId: safeThemeId,
    customImageDataUrl
  };
}

function parseBrandTokens(str) {
  if (!str || !String(str).trim()) return [];
  return String(str)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeChainRolesFromStages(stages) {
  if (!Array.isArray(stages)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of stages) {
    const role = typeof raw === 'string' ? raw : raw?.role;
    if (!role || seen.has(role)) continue;
    if (!SUPPLY_CHAIN_ROLES_IN_ORDER.includes(role)) continue;
    seen.add(role);
    out.push(role);
  }
  return out;
}

function intersectRoleLists(roleLists) {
  if (!Array.isArray(roleLists) || roleLists.length === 0) return [];
  let current = new Set(roleLists[0]);
  for (let i = 1; i < roleLists.length; i += 1) {
    const next = new Set(roleLists[i]);
    current = new Set([...current].filter((r) => next.has(r)));
    if (current.size === 0) break;
  }
  return SUPPLY_CHAIN_ROLES_IN_ORDER.filter((r) => current.has(r));
}

async function resolveChainRoleOptionsForBrands(brandInputs = []) {
  const brands = [...new Set((brandInputs || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (brands.length === 0) {
    return {
      brands: [],
      roles: [],
      eligible: false,
      reason: 'no_brand_selected',
      message: 'Select at least one brand to load available supply-chain roles.'
    };
  }

  const normalizedBrands = brands.map((b) => ({
    original: b,
    normalized: normalizeBrandKey(b)
  }));

  const brandKeys = normalizedBrands.map((b) => b.normalized).filter(Boolean);
  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('name, normalized_name, status')
    .in('normalized_name', brandKeys);
  if (brandError) throw brandError;

  const { data: chainRows, error: chainError } = await supabase
    .from('category_supply_chains')
    .select('category_name, stages, updated_at');
  if (chainError) throw chainError;

  const brandByKey = new Map();
  for (const row of brandRows || []) {
    const key = normalizeBrandKey(row?.normalized_name || row?.name);
    if (key && !brandByKey.has(key)) brandByKey.set(key, row);
  }
  const chainByKey = new Map();
  for (const row of chainRows || []) {
    const key = normalizeBrandKey(row?.category_name);
    if (!key) continue;
    const existing = chainByKey.get(key);
    if (!existing) {
      chainByKey.set(key, row);
      continue;
    }
    const existingRoles = normalizeChainRolesFromStages(existing?.stages);
    const nextRoles = normalizeChainRolesFromStages(row?.stages);
    // Prefer rows that actually contain a valid chain. If both are valid/invalid,
    // keep the most recently updated row to avoid stale duplicates.
    if (nextRoles.length > existingRoles.length) {
      chainByKey.set(key, row);
      continue;
    }
    if (nextRoles.length === existingRoles.length) {
      const existingTs = Date.parse(existing?.updated_at || 0) || 0;
      const nextTs = Date.parse(row?.updated_at || 0) || 0;
      if (nextTs > existingTs) {
        chainByKey.set(key, row);
      }
    }
  }

  const perBrand = [];
  const roleLists = [];
  const rolesByBrand = {};
  let blockedReason = null;
  const notApprovedBrands = [];
  const missingChainBrands = [];
  for (const b of normalizedBrands) {
    const brandRow = brandByKey.get(b.normalized) || null;
    const brandStatus = String(brandRow?.status || 'missing');

    const chainRow = chainByKey.get(b.normalized) || null;
    const roles = normalizeChainRolesFromStages(chainRow?.stages);
    // If admin already defined a chain for this brand, treat it as eligible for role resolution
    // even when the legacy brands.status is still pending/rejected due to older data.
    if (brandStatus !== 'approved' && roles.length === 0) {
      blockedReason = 'brand_not_approved';
      notApprovedBrands.push(brandRow?.name || b.original);
    }
    if (roles.length === 0) {
      if (!blockedReason) blockedReason = 'supply_chain_not_defined';
      missingChainBrands.push(brandRow?.name || b.original);
    } else {
      roleLists.push(roles);
    }
    rolesByBrand[b.normalized] = roles;

    perBrand.push({
      brand: brandRow?.name || b.original,
      normalizedBrand: b.normalized,
      status: brandStatus,
      hasSupplyChainDefinition: roles.length > 0,
      roles
    });
  }

  if (blockedReason) {
    return {
      brands: perBrand,
      roles: [],
      rolesByBrand,
      eligible: false,
      reason: blockedReason,
      notApprovedBrands,
      missingChainBrands,
      message:
        blockedReason === 'brand_not_approved'
          ? `One or more selected brands are not approved by admin yet: ${notApprovedBrands.join(', ')}.`
          : `Supply chain is not defined by admin for: ${missingChainBrands.join(', ')}.`
    };
  }

  const allowedRoles = intersectRoleLists(roleLists);
  return {
    brands: perBrand,
    roles: allowedRoles,
    rolesByBrand,
    eligible: allowedRoles.length > 0,
    reason: allowedRoles.length > 0 ? null : 'no_common_role',
    message:
      allowedRoles.length > 0
        ? null
        : 'Selected brands do not share a common role. Split brands into separate entries so each brand follows its own admin-defined chain.'
  };
}

function extractBrandFromOrderItem(orderItem = {}) {
  const product = orderItem.product || {};
  const productSpecs = product.specifications || {};
  let lineSpecs = {};
  if (orderItem.specifications && typeof orderItem.specifications === 'string') {
    try {
      lineSpecs = JSON.parse(orderItem.specifications);
    } catch {
      lineSpecs = {};
    }
  } else if (orderItem.specifications && typeof orderItem.specifications === 'object') {
    lineSpecs = orderItem.specifications;
  }

  const rawBrand =
    product.brand ||
    productSpecs.brand ||
    productSpecs.brandModel ||
    lineSpecs.brand ||
    lineSpecs.brandModel ||
    '';

  const normalized = normalizeBrandKey(rawBrand);
  return {
    normalized,
    display: String(rawBrand || '').trim() || 'Unknown'
  };
}

async function computePurchaseSummary(userId) {
  const summary = {
    totalOrdersPlaced: 0,
    totalAmountPlaced: 0,
    totalAmountPaid: 0,
    topPurchasedBrand: null
  };

  const { data: placedOrders, error: placedOrdersError } = await supabase
    .from('orders')
    .select('id, total_amount, payment_status')
    .eq('service_provider_id', userId);

  if (placedOrdersError || !Array.isArray(placedOrders)) {
    if (placedOrdersError) {
      console.error('[Profile] computePurchaseSummary orders error:', placedOrdersError);
    }
    return summary;
  }

  summary.totalOrdersPlaced = placedOrders.length;
  summary.totalAmountPlaced = placedOrders.reduce(
    (sum, row) => sum + (parseFloat(row.total_amount) || 0),
    0
  );
  summary.totalAmountPaid = placedOrders.reduce((sum, row) => {
    const paid = String(row.payment_status || '').toLowerCase() === 'paid';
    return sum + (paid ? parseFloat(row.total_amount) || 0 : 0);
  }, 0);

  const orderIds = placedOrders.map((o) => o.id).filter(Boolean);
  if (orderIds.length === 0) return summary;

  const { data: lineItems, error: lineItemsError } = await supabase
    .from('order_items')
    .select(`
      quantity,
      total_price,
      specifications,
      product:products (
        brand,
        specifications
      )
    `)
    .in('order_id', orderIds);

  if (lineItemsError || !Array.isArray(lineItems)) {
    if (lineItemsError) {
      console.error('[Profile] computePurchaseSummary line items error:', lineItemsError);
    }
    return summary;
  }

  const byBrand = new Map();
  for (const li of lineItems) {
    const { normalized, display } = extractBrandFromOrderItem(li);
    const key = normalized || 'unknown';
    const existing = byBrand.get(key) || {
      brand: display,
      totalQuantity: 0,
      totalAmount: 0,
      orderLineCount: 0
    };
    existing.totalQuantity += parseFloat(li.quantity) || 0;
    existing.totalAmount += parseFloat(li.total_price) || 0;
    existing.orderLineCount += 1;
    if ((existing.brand === 'Unknown' || !existing.brand) && display !== 'Unknown') {
      existing.brand = display;
    }
    byBrand.set(key, existing);
  }

  if (byBrand.size > 0) {
    const ranked = Array.from(byBrand.values()).sort((a, b) => {
      if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
      if (b.totalQuantity !== a.totalQuantity) return b.totalQuantity - a.totalQuantity;
      return b.orderLineCount - a.orderLineCount;
    });
    summary.topPurchasedBrand = ranked[0];
  }

  // Standardize for consistent rendering/rounding in all portals.
  summary.totalAmountPlaced = Number(summary.totalAmountPlaced.toFixed(2));
  summary.totalAmountPaid = Number(summary.totalAmountPaid.toFixed(2));
  if (summary.topPurchasedBrand) {
    summary.topPurchasedBrand.totalAmount = Number(summary.topPurchasedBrand.totalAmount.toFixed(2));
    summary.topPurchasedBrand.totalQuantity = Number(summary.topPurchasedBrand.totalQuantity.toFixed(2));
  }

  return summary;
}

async function ensureBrandApprovedOrRequest({ brandName, requesterUserId }) {
  const name = String(brandName || '').trim();
  const normalized = normalizeBrandKey(name);

  if (!name || !normalized) {
    return { ok: false, code: 'brand_required', message: 'Brand is required.' };
  }

  let brandRow = null;
  try {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('normalized_name', normalized)
      .maybeSingle();
    if (error) throw error;
    brandRow = data;
  } catch (e) {
    return {
      ok: false,
      code: 'brand_workflow_not_ready',
      message: 'Brand approval workflow is not available yet. Please ask admin to run the brand migration.'
    };
  }

  if (!brandRow) {
    const nowIso = new Date().toISOString();
    const { data: created, error: insertError } = await supabase
      .from('brands')
      .insert({
        name,
        normalized_name: normalized,
        status: 'pending',
        requested_by: requesterUserId,
        requested_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select()
      .single();

    if (insertError) {
      const { data: reread } = await supabase
        .from('brands')
        .select('*')
        .eq('normalized_name', normalized)
        .maybeSingle();
      brandRow = reread || null;
    } else {
      brandRow = created;
    }
  }

  const status = String(brandRow?.status || 'pending');
  if (status === 'approved') return { ok: true, brand: brandRow };

  // If this normalized brand already has approved active supplier offers in catalog,
  // auto-mark the brand approved globally to avoid repeated approval prompts.
  const { data: approvedOffers, error: offerErr } = await supabase
    .from('supplier_products')
    .select(`
      status,
      is_active,
      attributes,
      product:products (
        status,
        brand,
        specifications
      )
    `)
    .eq('status', 'approved')
    .eq('is_active', true)
    .limit(5000);
  if (!offerErr) {
    const hasApprovedEvidence = (approvedOffers || []).some((row) => {
      const productStatus = String(row?.product?.status || '').toLowerCase();
      if (productStatus && productStatus !== 'approved') return false;
      const approvedBrand =
        row?.attributes?.brand ||
        row?.attributes?.brandModel ||
        row?.product?.brand ||
        row?.product?.specifications?.brand ||
        row?.product?.specifications?.brandModel ||
        '';
      return normalizeBrandKey(approvedBrand) === normalized;
    });
    if (hasApprovedEvidence) {
      const nowIso = new Date().toISOString();
      if (brandRow?.id) {
        const { data: updated, error: upErr } = await supabase
          .from('brands')
          .update({
            status: 'approved',
            approved_at: nowIso,
            updated_at: nowIso,
            rejection_reason: null
          })
          .eq('id', brandRow.id)
          .select()
          .single();
        if (!upErr && updated) return { ok: true, brand: updated };
      } else {
        const { data: createdApproved, error: createApprovedErr } = await supabase
          .from('brands')
          .insert({
            name,
            normalized_name: normalized,
            status: 'approved',
            requested_by: requesterUserId,
            requested_at: nowIso,
            approved_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso
          })
          .select()
          .single();
        if (!createApprovedErr && createdApproved) return { ok: true, brand: createdApproved };
      }
    }
  }

  return {
    ok: false,
    code: 'brand_approval_required',
    message:
      status === 'rejected'
        ? `Brand "${brandRow?.name || name}" was rejected by admin. Please use another brand or request approval again.`
        : `Brand "${brandRow?.name || name}" is pending admin approval. Please wait for approval before proceeding.`,
    brand: brandRow
  };
}

// Get user profile
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({ 
        status: 'error',
        message: 'User not found' 
      });
    }

    // Remove password from response
    delete user.password;

    // Return profile structure based on user type
    const profile = await createProfileResponse(user);
    res.json({ 
      status: 'success',
      profile 
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.get('/service-provider/theme', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, user_type, profile')
      .eq('id', req.userId)
      .single();
    if (error || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (String(user.user_type) !== 'service_provider') {
      return res.status(403).json({ status: 'error', message: 'Only service providers can access portal theme.' });
    }
    const theme = sanitizeServiceProviderThemePrefs(user?.profile?.serviceProviderPortalTheme || {});
    return res.json({ status: 'success', theme });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to load portal theme.' });
  }
});

router.put('/service-provider/theme', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, user_type, profile')
      .eq('id', req.userId)
      .single();
    if (error || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    if (String(user.user_type) !== 'service_provider') {
      return res.status(403).json({ status: 'error', message: 'Only service providers can update portal theme.' });
    }
    const theme = sanitizeServiceProviderThemePrefs(req.body || {});
    const nextProfile = {
      ...(user.profile || {}),
      serviceProviderPortalTheme: {
        ...theme,
        updatedAt: new Date().toISOString()
      }
    };
    const { error: updateError } = await supabase
      .from('users')
      .update({ profile: nextProfile })
      .eq('id', req.userId);
    if (updateError) {
      throw updateError;
    }
    return res.json({ status: 'success', theme });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error?.message || 'Failed to save portal theme.'
    });
  }
});

// Resolve available supplier roles from admin-approved brand supply chains.
router.get('/supplier/chain-role-options', authenticateToken, async (req, res) => {
  try {
    const brandsRaw = String(req.query.brands || '');
    const brands = [...new Set(parseBrandTokens(brandsRaw))]
      .map((normalized) => {
        const original = brandsRaw
          .split(/[,;\n]/)
          .map((s) => String(s || '').trim())
          .find((s) => normalizeBrandKey(s) === normalized);
        return original || normalized;
      })
      .filter(Boolean);
    const resolved = await resolveChainRoleOptionsForBrands(brands);
    return res.json({
      status: 'success',
      ...resolved
    });
  } catch (error) {
    console.error('supplier chain role options error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to resolve supply-chain role options'
    });
  }
});

// Update user profile
router.put('/', authenticateToken, async (req, res) => {
  try {
    const profileData = parseWithSchema(profileUpdateSchema, req.body || {});
    
    // Get current user to merge with existing data
    const { data: currentUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (fetchError || !currentUser) {
      return res.status(404).json({ 
        status: 'error',
        message: 'User not found' 
      });
    }

    // Prepare update data
    const updateData = {
      company: profileData.companyName,
      phone: profileData.phone
    };

    // Handle address (JSONB field)
    if (profileData.address) {
      updateData.address = {
        ...(currentUser.address || {}),
        ...profileData.address
      };
    }

    // Handle profile (JSONB field)
    const currentProfile = currentUser.profile || {};
    const profileUpdate = {
      ...currentProfile,
      website: profileData.website,
      description: profileData.description
    };

    let chainApprovalPending = false;

    // Add user type specific fields
    if (profileData.userType === 'service_provider') {
      const mergedAddress = {
        ...(currentUser.address || {}),
        ...(profileData.address || {})
      };
      const requiredAddressFields = ['line1', 'city', 'state', 'pincode', 'country'];
      const missingField = requiredAddressFields.find(
        (field) => !String(mergedAddress?.[field] || '').trim()
      );
      if (missingField) {
        return res.status(400).json({
          status: 'error',
          code: 'service_provider_address_required',
          message: `Address field "${missingField}" is required for service provider profile.`
        });
      }

      updateData.address = mergedAddress;
      const billingAddresses = Array.isArray(profileData.billingAddresses)
        ? profileData.billingAddresses.map((entry) => ({
            ...entry,
            id: entry.id || uuidv4()
          }))
        : [];
      const requiredBillingFields = ['line1', 'city', 'state', 'pincode', 'country'];
      for (let i = 0; i < billingAddresses.length; i += 1) {
        const entry = billingAddresses[i] || {};
        const missingBillingField = requiredBillingFields.find(
          (field) => !String(entry?.[field] || '').trim()
        );
        if (missingBillingField) {
          return res.status(400).json({
            status: 'error',
            code: 'service_provider_billing_address_incomplete',
            message: `Billing address ${i + 1} is missing required field "${missingBillingField}".`
          });
        }
      }
      profileUpdate.billingAddresses = billingAddresses;
      // Service provider profile no longer stores company compliance details.
      delete profileUpdate.gstin;
      delete profileUpdate.panNumber;
      // Normalize projects - ensure they have proper IDs
      const projects = (profileData.projects || []).map(project => ({
        ...project,
        id: project.id || uuidv4()
      }));
      profileUpdate.projects = projects;
    } else if (profileData.userType === 'supplier') {
      profileUpdate.businessType = profileData.businessType;
      profileUpdate.categories = profileData.categories || [];
      profileUpdate.gstin = profileData.gstin || profileData.mainGstin;
      profileUpdate.ownershipDetails = profileData.ownershipDetails;
      if (profileData.skus !== undefined) {
        profileUpdate.skus = profileData.skus;
      } else if (profileData.skuList !== undefined) {
        profileUpdate.skus = profileData.skuList;
      }
      if (profileData.authorizationCertificateUrl) {
        profileUpdate.authorizationCertificateUrl = profileData.authorizationCertificateUrl;
      }
      const branches = (profileData.branches || []).map(branch => ({
        ...branch,
        id: branch.id || uuidv4()
      }));
      profileUpdate.branches = branches;

      const incomingChain = buildChainPayloadFromProfileData(profileData);
      const baselineChain = baselineChainFromProfile(currentProfile);
      const hasRole = hasAnySupplyChainRole(incomingChain);

      const collectBrandStringsFromChain = (chain) => {
        const brandStrings = [];
        if (typeof chain.brands === 'string') brandStrings.push(chain.brands);
        for (const e of chain.companyInfoEntries || []) {
          if (typeof e?.brands === 'string') brandStrings.push(e.brands);
        }
        return brandStrings;
      };

      const runGlobalBrandGate = async (chain) => {
        if (!hasAnySupplyChainRole(chain)) return null;
        const brandStrings = collectBrandStringsFromChain(chain);
        const uniqueBrands = [
          ...new Set(
            brandStrings
              .flatMap((s) => parseBrandTokens(s))
              .map((b) => b.trim())
              .filter(Boolean)
          )
        ];
        if (uniqueBrands.length === 0) return null;
        const failures = [];
        for (const b of uniqueBrands) {
          const approval = await ensureBrandApprovedOrRequest({
            brandName: b,
            requesterUserId: req.userId
          });
          if (!approval.ok) {
            failures.push({
              brand: b,
              code: approval.code,
              status: approval.brand?.status || null,
              message: approval.message
            });
          }
        }
        return failures.length > 0 ? failures : null;
      };

      if (!hasRole) {
        try {
          await clearPendingChainRequest(req.userId);
        } catch (e) {
          console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
        }
        profileUpdate.supplierRole = incomingChain.supplierRole;
        profileUpdate.brands = incomingChain.brands;
        profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
      } else {
        const brandFailures = await runGlobalBrandGate(incomingChain);
        if (brandFailures) {
          return res.status(403).json({
            status: 'error',
            code: 'brand_approval_required_for_profile',
            message:
              'Some brands in your profile are not approved yet. Requests have been created (if needed). Please wait for admin approval, then save again.',
            brands: brandFailures
          });
        }

        const roleBrandSelections = [];
        const entriesForValidation = Array.isArray(incomingChain.companyInfoEntries)
          ? incomingChain.companyInfoEntries
          : [];
        for (const e of entriesForValidation) {
          const role = String(e?.role || '').trim();
          const brandsStr = String(e?.brands || '').trim();
          if (!role) continue;
          roleBrandSelections.push({ role, brands: parseBrandTokens(brandsStr) });
        }
        if (roleBrandSelections.length === 0 && incomingChain.supplierRole) {
          roleBrandSelections.push({
            role: String(incomingChain.supplierRole).trim(),
            brands: parseBrandTokens(incomingChain.brands || '')
          });
        }

        for (const selection of roleBrandSelections) {
          if (!selection.brands || selection.brands.length === 0) {
            return res.status(403).json({
              status: 'error',
              code: 'chain_role_requires_brand',
              message: 'Select at least one brand before choosing your supply-chain role.'
            });
          }

          const resolved = await resolveChainRoleOptionsForBrands(selection.brands);
          if (!resolved.eligible) {
            return res.status(403).json({
              status: 'error',
              code: 'supply_chain_not_defined_for_selected_brand',
              message:
                resolved.message ||
                'Admin has not defined a valid supply chain for selected brand(s), so role selection is not allowed.',
              details: {
                role: selection.role,
                brands: resolved.brands || []
              }
            });
          }

          const invalidBrandsForRole = (resolved.brands || []).filter((b) => {
            const key = String(b?.normalizedBrand || '');
            const rolesForThisBrand = Array.isArray(resolved.rolesByBrand?.[key]) ? resolved.rolesByBrand[key] : [];
            return !rolesForThisBrand.includes(selection.role);
          });
          if (invalidBrandsForRole.length > 0) {
            return res.status(403).json({
              status: 'error',
              code: 'role_brand_chain_mismatch',
              message:
                'Selected role does not match admin-defined chain for some brands. Keep brands in separate entries according to their own supply chain.',
              details: {
                role: selection.role,
                mismatchedBrands: invalidBrandsForRole
              }
            });
          }
        }

        if (chainPayloadSignature(incomingChain) === chainPayloadSignature(baselineChain)) {
          try {
            await clearPendingChainRequest(req.userId);
          } catch (e) {
            console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
          }
          profileUpdate.supplierRole = incomingChain.supplierRole;
          profileUpdate.brands = incomingChain.brands;
          profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
        } else {
          try {
            await replacePendingChainRequest(req.userId, incomingChain);
          } catch (e) {
            console.error('[Profile] replacePendingChainRequest:', e);
            return res.status(503).json({
              status: 'error',
              code: 'chain_request_table_missing',
              message:
                'Profile approval workflow is not available. Ask admin to run migration_supplier_chain_profile_requests.sql in Supabase.'
            });
          }
          chainApprovalPending = true;
          profileUpdate.supplierRole = baselineChain.supplierRole;
          profileUpdate.brands = baselineChain.brands;
          profileUpdate.companyInfoEntries = baselineChain.companyInfoEntries;

          try {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
            const { data: adminRows } = await findAdmins(adminEmail, supabase);
            const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
            if (adminIds.length > 0) {
              const supplierName = currentUser.name || 'Supplier';
              const supplierEmail = currentUser.email || '';
              const preview = incomingChain.companyInfoEntries?.length
                ? incomingChain.companyInfoEntries
                    .map((e) => `${e.role}: ${String(e.brands || '').slice(0, 60)}`)
                    .join('; ')
                : `${incomingChain.supplierRole || '—'} — brands: ${String(incomingChain.brands || '').slice(0, 80)}`;
              const notifications = adminIds.map((adminId) => ({
                user_id: adminId,
                type: 'supplier_chain_profile_pending',
                title: `Supplier chain profile pending: ${supplierName}`,
                message: `${supplierName} (${supplierEmail}) submitted supply-chain role/brand changes for admin approval. ${preview}`,
                related_supplier_id: req.userId,
                metadata: { source: 'supplier_chain_profile_pending', supplierId: req.userId },
                is_read: false
              }));
              await insertNotifications(notifications, supabase);
            }
          } catch (notifErr) {
            console.error('[Profile] Failed to notify admins (chain pending):', notifErr);
          }
        }
      }
    }

    updateData.profile = profileUpdate;

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Update user
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.userId)
      .select()
      .single();

    if (updateError || !updatedUser) {
      console.error('Update error:', updateError);
      return res.status(400).json({ 
        status: 'error',
        message: updateError?.message || 'Failed to update profile' 
      });
    }

    // Remove password from response
    delete updatedUser.password;

    // Notify admins when supplier sets or changes supply-chain position (single role or companyInfoEntries)
    if (!chainApprovalPending && updatedUser.user_type === 'supplier') {
      const entries = updatedUser.profile?.companyInfoEntries || [];
      const prevEntries = currentProfile.companyInfoEntries || [];
      const prevRole = String(currentProfile.supplierRole || '').trim();
      const newRole = String(updatedUser.profile?.supplierRole || '').trim();
      const entriesChanged =
        prevEntries.length !== entries.length ||
        JSON.stringify(prevEntries.map((e) => ({ r: e.role, b: e.brands, g: e.gstin, c: e.companyName }))) !==
          JSON.stringify(entries.map((e) => ({ r: e.role, b: e.brands, g: e.gstin, c: e.companyName })));
      const singleRoleChanged = newRole && newRole !== prevRole && entries.length === 0;
      if (entriesChanged || singleRoleChanged) {
        const roleLabels = {
          manufacturer: 'Manufacturer (MGF)',
          stockist: 'Stockist',
          regional_distributor: 'Regional distributor',
          local_distributor: 'Local distributor',
          dealer: 'Dealer',
          retailer: 'Retailer'
        };
        const effectiveRole = entries.length > 0 ? entries[0].role : newRole;
        const label = roleLabels[effectiveRole] || effectiveRole;
        const chainHint =
          'Chain order: MGF → Stockist → Regional distributor → Local distributor → Dealer → Retailer.';
        const supplierName = updatedUser.name || 'Supplier';
        const supplierEmail = updatedUser.email || '';
        const supplierCompany =
          updatedUser.company || profileData.companyName || '—';
        const gstin =
          updatedUser.profile?.gstin || profileUpdate.gstin || '—';
        let brandsStr = '—';
        if (entries.length > 0) {
          brandsStr = entries.map((e) => `${roleLabels[e.role] || e.role}: ${(e.brands || '').slice(0, 80)}`).join('; ');
        } else {
          const brandsRaw =
            updatedUser.profile?.brands ??
            profileUpdate.brands ??
            profileData.brands;
          brandsStr =
            typeof brandsRaw === 'string'
              ? brandsRaw
              : Array.isArray(brandsRaw)
                ? brandsRaw.join(', ')
                : brandsRaw
                  ? JSON.stringify(brandsRaw)
                  : '—';
        }
        const shortBrands =
          brandsStr.length > 280 ? `${brandsStr.slice(0, 277)}…` : brandsStr;

        try {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
          const { data: adminRows } = await findAdmins(adminEmail, supabase);

          const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
          if (adminIds.length > 0) {
            const notifications = adminIds.map((adminId) => ({
              user_id: adminId,
              type: 'supplier_edit',
              title: entries.length > 1
                ? `Supplier profile: ${entries.length} roles (${label}, …)`
                : `Supplier profile: ${label}`,
              message:
                `${supplierName} (${supplierEmail}) — ${supplierCompany} has registered in the supply chain as: ${label}. ${chainHint} ` +
                `GSTIN: ${gstin}. Brands handled: ${shortBrands}.` +
                (prevRole
                  ? ` (Previous role: ${roleLabels[prevRole] || prevRole}.)`
                  : ''),
              related_supplier_id: updatedUser.id,
              metadata: {
                source: 'supplier_profile_supply_chain',
                supplierId: updatedUser.id,
                supplierName,
                supplierEmail,
                supplierCompany,
                supplierRole: effectiveRole,
                supplierRoleLabel: label,
                companyInfoEntries: entries,
                previousSupplierRole: prevRole || null,
                gstin: gstin !== '—' ? gstin : null,
                brands: entries.length > 0 ? entries : profileUpdate.brands
              },
              is_read: false
            }));

            await insertNotifications(notifications, supabase);
            console.log(
              `[Profile] Notified ${notifications.length} admin(s): supplier ${updatedUser.id} role ${newRole}`
            );
          }
        } catch (notifErr) {
          console.error(
            '[Profile] Failed to notify admins about supplier chain role:',
            notifErr
          );
        }
      }
    }

    const profile = await createProfileResponse(updatedUser);
    const payload = {
      status: 'success',
      message: chainApprovalPending
        ? 'Your supply-chain role and brand assignment was submitted for admin approval. Until it is approved, your previous approved assignment stays active.'
        : 'Profile updated successfully',
      profile
    };
    if (chainApprovalPending) {
      payload.chainApprovalPending = true;
    }
    res.json(payload);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update profile error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Helper function to create profile response structure
async function createProfileResponse(user) {
  const baseProfile = {
    userId: user.id,
    companyName: user.company || '',
    contactPerson: user.name,
    phone: user.phone || '',
    email: user.email,
    address: user.address || {},
    website: user.profile?.website || '',
    description: user.profile?.description || '',
    userType: user.user_type,
    createdAt: user.created_at
  };

  if (user.user_type === 'service_provider') {
    const purchaseSummary = await computePurchaseSummary(user.id);
    let serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    try {
      serviceProviderPortalTheme = sanitizeServiceProviderThemePrefs(
        user.profile?.serviceProviderPortalTheme || {}
      );
    } catch {
      serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    }

    return {
      ...baseProfile,
      projects: user.profile?.projects || [],
      billingAddresses: user.profile?.billingAddresses || [],
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      serviceProviderPortalTheme
    };
  } else if (user.user_type === 'supplier') {
    const base = user.profile || {};
    const pending = await fetchPendingChainRequest(user.id);
    const latestReq = await fetchLatestChainRequest(user.id);

    const approvedChain = baselineChainFromProfile(base);
    const displayChain = pending?.payload
      ? {
          supplierRole: String(pending.payload.supplierRole || '').trim(),
          brands: typeof pending.payload.brands === 'string' ? pending.payload.brands : '',
          companyInfoEntries: normalizeCompanyInfoEntries(pending.payload.companyInfoEntries || [])
        }
      : approvedChain;

    const entries = displayChain.companyInfoEntries || [];
    const firstEntry = entries[0];

    const chainProfileLastRejection =
      !pending && latestReq?.status === 'rejected'
        ? {
            reason: latestReq.rejection_reason || null,
            reviewedAt: latestReq.reviewed_at || null
          }
        : null;

    const purchaseSummary = await computePurchaseSummary(user.id);
    let totalOrdersReceived = 0;
    let totalRevenueReceived = 0;
    try {
      const { data: receivedOrders, error: receivedOrdersError } = await supabase
        .from('orders')
        .select('id, total_amount, payment_status')
        .eq('supplier_id', user.id);

      if (!receivedOrdersError && Array.isArray(receivedOrders)) {
        totalOrdersReceived = receivedOrders.length;
        totalRevenueReceived = receivedOrders.reduce((sum, row) => {
          const isPaid = String(row.payment_status || '').toLowerCase() === 'paid';
          return sum + (isPaid ? parseFloat(row.total_amount) || 0 : 0);
        }, 0);
      }
    } catch (statsError) {
      console.error('[Profile] Failed to compute supplier order stats:', statsError);
    }

    return {
      ...baseProfile,
      businessType: base.businessType || '',
      categories: base.categories || [],
      branches: base.branches || [],
      skus: base.skus || [],
      supplierRole: displayChain.supplierRole || (firstEntry?.role || ''),
      gstin: base.gstin || (firstEntry?.gstin || ''),
      ownershipDetails: base.ownershipDetails || (firstEntry?.ownershipDetails || ''),
      brands: displayChain.brands || (firstEntry?.brands || ''),
      authorizationCertificateUrl: base.authorizationCertificateUrl || '',
      companyInfoEntries: entries,
      chainProfileApprovalStatus: pending ? 'pending' : 'approved',
      chainProfilePendingSubmittedAt: pending?.created_at || null,
      chainProfilePendingId: pending?.id || null,
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      totalOrdersReceived,
      totalRevenueReceived,
      approvedChainProfile: pending
        ? {
            supplierRole: approvedChain.supplierRole,
            brands: approvedChain.brands,
            companyInfoEntries: approvedChain.companyInfoEntries
          }
        : null,
      chainProfileLastRejection
    };
  }

  return baseProfile;
}

// Upload supplier authorization certificate and store URL in profile
router.post(
  '/supplier/authorization-certificate',
  authenticateToken,
  upload.single('file'),
  async (req, res) => {
    try {
      const uploadBody = parseWithSchema(profileUploadCertificateBodySchema, req.body || {});
      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          message: 'No file uploaded'
        });
      }

      const filePath = req.file.path;
      const fileBuffer = fs.readFileSync(filePath);

      const storagePath = `${req.userId}/authorization-certificates/${Date.now()}-${req.file.originalname}`;

      const { url, path } = await uploadFile(
        'supplier-documents',
        storagePath,
        fileBuffer,
        {
          contentType: req.file.mimetype,
          upsert: false
        }
      );

      // Cleanup local temp file
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error('Failed to cleanup temp file:', cleanupError);
      }

      // Merge URL into user's profile JSONB
      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      const entryId = uploadBody.entryId ? String(uploadBody.entryId).trim() : null;

      if (entryId) {
        const pending = await fetchPendingChainRequest(req.userId);
        if (pending?.payload) {
          const p = pending.payload;
          const entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
          const updatedEntries = entries.map((e) =>
            e.id === entryId ? { ...e, authorizationCertificateUrl: url } : e
          );
          if (!updatedEntries.some((e) => e.id === entryId)) {
            return res.status(400).json({
              status: 'error',
              message: 'Entry not found on your pending profile submission'
            });
          }
          const { error: prErr } = await supabase
            .from('supplier_chain_profile_requests')
            .update({
              payload: { ...p, companyInfoEntries: updatedEntries },
              updated_at: new Date().toISOString()
            })
            .eq('id', pending.id)
            .eq('status', 'pending');
          if (prErr) {
            console.error('Failed to attach certificate to pending chain request:', prErr);
            return res.status(500).json({
              status: 'error',
              message: 'File uploaded, but failed to save URL on pending profile request'
            });
          }
          return res.status(200).json({
            status: 'success',
            message: 'Authorization certificate attached to your pending profile submission',
            url,
            entryId
          });
        }

        const entries = Array.isArray(currentUser.profile?.companyInfoEntries)
          ? currentUser.profile.companyInfoEntries
          : [];
        const updatedEntries = entries.map((e) =>
          e.id === entryId ? { ...e, authorizationCertificateUrl: url } : e
        );
        if (!updatedEntries.some((e) => e.id === entryId)) {
          return res.status(400).json({
            status: 'error',
            message: 'Entry not found for this certificate'
          });
        }
        const updatedProfile = {
          ...(currentUser.profile || {}),
          companyInfoEntries: updatedEntries
        };
        const { error: updateError } = await supabase
          .from('users')
          .update({ profile: updatedProfile })
          .eq('id', req.userId);

        if (updateError) {
          console.error('Failed to save certificate URL for entry:', updateError);
          return res.status(500).json({
            status: 'error',
            message: 'File uploaded, but failed to save URL for this entry'
          });
        }
        return res.status(200).json({
          status: 'success',
          message: 'Authorization certificate uploaded for this entry',
          url,
          entryId
        });
      }

      const updatedProfile = {
        ...(currentUser.profile || {}),
        authorizationCertificateUrl: url,
        authorizationCertificatePath: path
      };

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile: updatedProfile })
        .eq('id', req.userId);

      if (updateError) {
        console.error('Failed to update user profile with certificate URL:', updateError);
        return res.status(500).json({
          status: 'error',
          message: 'File uploaded, but failed to save URL in profile'
        });
      }

      return res.status(200).json({
        status: 'success',
        message: 'Authorization certificate uploaded successfully',
        url
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Authorization certificate upload error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to upload authorization certificate'
      });
    }
  }
);

export { router as profileRouter };
