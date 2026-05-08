import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { requireAuthentication as authenticateToken, requireServiceProvider as isServiceProvider } from '../middleware/authMiddleware.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import {
  vapiServerMessageSchema,
  voiceSessionRequestSchema,
  voiceToolArgsByName
} from '../contracts/voiceContracts.js';

const router = express.Router();
const VOICE_SESSION_TTL_SECONDS = Number.parseInt(process.env.VOICE_SESSION_TTL_SECONDS || '900', 10);
const VOICE_SESSION_SECRET = process.env.VOICE_SESSION_SECRET || process.env.JWT_SECRET;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || '';
const VAPI_PUBLIC_KEY = process.env.VAPI_PUBLIC_KEY || '';
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || '';
const ALLOW_INSECURE_VAPI_WEBHOOK =
  String(process.env.VOICE_ALLOW_INSECURE_WEBHOOK || '').trim().toLowerCase() === 'true' ||
  process.env.NODE_ENV !== 'production';
const idempotencyCache = new Map();
const searchProductsCache = new Map();
const recentVoiceSessions = [];
const callIdToVoiceUserId = new Map();
const voiceFlowByUserId = new Map();
const voicePageContextByUserId = new Map();

const FLOW_STEPS = {
  discovery: 'discovery',
  cart_ready: 'cart_ready',
  supplier_selection: 'supplier_selection',
  checkout_details: 'checkout_details',
  review_ready: 'review_ready'
};

function tokenizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreProductMatch(product, queryTokens) {
  if (!queryTokens.length) return 0;
  const haystack = `${product?.name || ''} ${product?.brand || ''} ${product?.category || ''}`.toLowerCase();
  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) score += 1;
  });
  return score;
}

async function searchPlatformDiscoveryProducts({ query, category, limit }) {
  const normalizedQuery = String(query || '').trim();
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const rankingPoolLimit = normalizedQuery ? 120 : 40;

  let productsQuery = supabase
    .from('products')
    .select(
      `
        id,
        name,
        category,
        unit,
        brand,
        updated_at,
        supplier_products!inner(count)
      `
    )
    .eq('status', 'approved')
    .eq('supplier_products.status', 'approved')
    .eq('supplier_products.is_active', true)
    .order('updated_at', { ascending: false })
    .limit(rankingPoolLimit);

  if (normalizedCategory) {
    productsQuery = productsQuery.eq('category', normalizedCategory);
  }
  if (normalizedQuery) {
    const ilikeQuery = `%${normalizedQuery.replace(/\s+/g, '%')}%`;
    productsQuery = productsQuery.or(`name.ilike.${ilikeQuery},brand.ilike.${ilikeQuery}`);
  }

  const { data, error } = await productsQuery;
  if (error) throw error;

  const rawProducts = Array.isArray(data) ? data : [];
  if (!normalizedQuery) return rawProducts.slice(0, limit);

  if (rawProducts.length > 0) return rawProducts.slice(0, limit);

  // Fallback pass: fetch latest listed products and rank by token overlap for STT variation.
  const { data: fallbackData, error: fallbackError } = await supabase
    .from('products')
    .select(
      `
        id,
        name,
        category,
        unit,
        brand,
        updated_at,
        supplier_products!inner(count)
      `
    )
    .eq('status', 'approved')
    .eq('supplier_products.status', 'approved')
    .eq('supplier_products.is_active', true)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (fallbackError) throw fallbackError;

  const tokens = tokenizeSearchText(normalizedQuery);
  const ranked = (Array.isArray(fallbackData) ? fallbackData : [])
    .map((product) => ({ product, score: scoreProductMatch(product, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);

  return ranked.slice(0, limit);
}

function getInternalApiBaseUrl() {
  if (process.env.INTERNAL_API_BASE_URL) return process.env.INTERNAL_API_BASE_URL;
  const port = process.env.PORT || '8081';
  return `http://127.0.0.1:${port}`;
}

function buildAppJwtForUser(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '15m'
  });
}

function issueVoiceSessionToken(userId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload = {
    sub: String(userId),
    jti,
    typ: 'voice_session'
  };
  const token = jwt.sign(payload, VOICE_SESSION_SECRET, {
    expiresIn: VOICE_SESSION_TTL_SECONDS
  });
  return {
    token,
    expiresAt: new Date((nowSeconds + VOICE_SESSION_TTL_SECONDS) * 1000).toISOString()
  };
}

function rememberVoiceSession(userId, token, expiresAtIso) {
  const expiresAtMs = Date.parse(expiresAtIso) || Date.now() + VOICE_SESSION_TTL_SECONDS * 1000;
  recentVoiceSessions.push({
    userId: String(userId),
    token: String(token),
    issuedAtMs: Date.now(),
    expiresAtMs
  });
  const now = Date.now();
  while (recentVoiceSessions.length > 30) recentVoiceSessions.shift();
  for (let i = recentVoiceSessions.length - 1; i >= 0; i -= 1) {
    if (recentVoiceSessions[i].expiresAtMs < now) {
      recentVoiceSessions.splice(i, 1);
    }
  }
}

function parseVoiceSessionToken(token) {
  const decoded = jwt.verify(token, VOICE_SESSION_SECRET);
  if (!decoded || decoded.typ !== 'voice_session' || !decoded.sub) {
    throw new Error('Invalid voice session');
  }
  return {
    userId: String(decoded.sub)
  };
}

function parseToolArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed);
  }
  if (typeof rawArgs === 'object') return rawArgs;
  return {};
}

function collectToolCalls(message) {
  const direct = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  const directAlt = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const nested = (message.toolWithToolCallList || []).flatMap((entry) =>
    Array.isArray(entry?.toolCallList) ? entry.toolCallList : []
  );
  return [...direct, ...directAlt, ...nested];
}

function extractVoiceSessionToken(reqBody, message) {
  return String(
    message?.call?.metadata?.voiceSessionToken ||
      message?.metadata?.voiceSessionToken ||
      reqBody?.message?.metadata?.voiceSessionToken ||
      reqBody?.call?.metadata?.voiceSessionToken ||
      reqBody?.metadata?.voiceSessionToken ||
      ''
  );
}

function resolveUserIdFromToolRequest(reqBody, message) {
  const directToken = extractVoiceSessionToken(reqBody, message);
  if (directToken) {
    const parsed = parseVoiceSessionToken(directToken);
    const callId = String(message?.call?.id || reqBody?.call?.id || '').trim();
    if (callId) callIdToVoiceUserId.set(callId, parsed.userId);
    return parsed.userId;
  }

  const callId = String(message?.call?.id || reqBody?.call?.id || '').trim();
  if (callId && callIdToVoiceUserId.has(callId)) {
    return callIdToVoiceUserId.get(callId);
  }

  // Fallback for providers that omit metadata on tool-calls.
  // Restricted to local/dev via ALLOW_INSECURE_VAPI_WEBHOOK.
  if (ALLOW_INSECURE_VAPI_WEBHOOK) {
    const now = Date.now();
    const candidates = recentVoiceSessions.filter((entry) => entry.expiresAtMs > now);
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (callId) callIdToVoiceUserId.set(callId, candidate.userId);
      return candidate.userId;
    }
    if (callId && candidates.length > 1) {
      const latest = candidates[candidates.length - 1];
      callIdToVoiceUserId.set(callId, latest.userId);
      return latest.userId;
    }
  }

  throw new Error('voiceSessionToken is missing in metadata');
}

function getFlowState(userId) {
  const uid = String(userId || '');
  if (!voiceFlowByUserId.has(uid)) {
    voiceFlowByUserId.set(uid, { step: FLOW_STEPS.discovery, updatedAt: Date.now() });
  }
  return voiceFlowByUserId.get(uid);
}

function setFlowState(userId, step) {
  const uid = String(userId || '');
  voiceFlowByUserId.set(uid, { step, updatedAt: Date.now() });
}

function sanitizeVoicePageContext(rawContext) {
  if (!rawContext || typeof rawContext !== 'object') return null;
  if (rawContext.page !== 'product_discovery') return null;
  const visibleProducts = Array.isArray(rawContext.visibleProducts)
    ? rawContext.visibleProducts.slice(0, 40).map((product) => ({
        id: String(product?.id || ''),
        name: String(product?.name || ''),
        brand: String(product?.brand || ''),
        category: String(product?.category || ''),
        unit: String(product?.unit || ''),
        supplierCount: Number(product?.supplierCount || 0) || 0,
        barcode: String(product?.barcode || ''),
        description: String(product?.description || '')
      }))
    : [];
  return {
    page: 'product_discovery',
    searchQuery: String(rawContext.searchQuery || ''),
    selectedCategory: String(rawContext.selectedCategory || ''),
    currentPage: Number(rawContext.currentPage || 1) || 1,
    pageSize: Number(rawContext.pageSize || 24) || 24,
    total: Number(rawContext.total || 0) || 0,
    pageCount: Number(rawContext.pageCount || 1) || 1,
    recommendationMode: String(rawContext.recommendationMode || ''),
    visibleProducts,
    capturedAt: new Date().toISOString()
  };
}

function rememberVoicePageContext(userId, rawContext) {
  const uid = String(userId || '');
  const sanitized = sanitizeVoicePageContext(rawContext);
  if (!sanitized) return;
  voicePageContextByUserId.set(uid, {
    ...sanitized,
    updatedAtMs: Date.now()
  });
}

function getVoicePageContext(userId) {
  const uid = String(userId || '');
  const context = voicePageContextByUserId.get(uid);
  if (!context) return null;
  const { updatedAtMs: _updatedAtMs, ...rest } = context;
  return rest;
}

function extractDraftItems(draft) {
  const groupItems = Array.isArray(draft?.boqGroups)
    ? draft.boqGroups.flatMap((group) => (Array.isArray(group?.items) ? group.items : []))
    : [];
  if (groupItems.length) return groupItems;
  return Array.isArray(draft?.items) ? draft.items : [];
}

function summarizeCartForVoice(cart) {
  const draft = cart?.draft || {};
  const items = extractDraftItems(draft);
  const summaryItems = items.map((item) => ({
    itemId: String(item?.id || ''),
    name: String(item?.normalizedName || item?.rawName || item?.name || 'Item'),
    quantity: Number(item?.quantity || 0) || 1,
    unit: String(item?.unit || 'nos')
  }));
  const selectedCount = Object.values(draft.selectedVendors || {}).filter(Boolean).length;
  return {
    itemCount: summaryItems.length,
    selectedSupplierCount: selectedCount,
    items: summaryItems
  };
}

function applySelectionsToDraft(draft, selections) {
  const normalizedSelections = {};
  selections.forEach((entry) => {
    normalizedSelections[String(entry.itemId)] = String(entry.vendorId);
  });
  return {
    ...draft,
    selectedVendors: {
      ...(draft?.selectedVendors || {}),
      ...normalizedSelections
    }
  };
}

function normalizeSupplierName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveDraftItemId(inputItemId, items) {
  const normalized = String(inputItemId || '').trim();
  if (!normalized) return '';
  const exact = (items || []).find((item) => String(item?.id || '') === normalized);
  if (exact) return String(exact.id);
  const suffix = (items || []).find((item) => String(item?.id || '').endsWith(`:${normalized}`));
  if (suffix) return String(suffix.id);
  return normalized;
}

function buildPoGroupRequestFromDraft(draft) {
  return {
    selectedVendors: draft?.selectedVendors || {},
    substitutions: Array.isArray(draft?.substitutions) ? draft.substitutions : [],
    items: extractDraftItems(draft)
  };
}

function isAddressComplete(address) {
  const requiredFields = ['line1', 'city', 'state', 'pincode', 'country'];
  return requiredFields.every((field) => Boolean(String(address?.[field] || '').trim()));
}

async function callInternalApi({ userId, method = 'GET', path, body, query }) {
  const url = new URL(`${getInternalApiBaseUrl()}${path}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) {
        url.searchParams.set(key, String(value));
      }
    });
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${buildAppJwtForUser(userId)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { status: 'error', message: text || 'Invalid JSON response' };
  }
  if (!response.ok) {
    throw new Error(parsed?.message || `Request failed: ${method} ${path}`);
  }
  return parsed;
}

async function getAllowedVendorsByItem(userId, draft) {
  const items = extractDraftItems(draft);
  if (!items.length) return new Map();
  const rankData = await callInternalApi({
    userId,
    method: 'POST',
    path: '/api/vendors/rank',
    body: { items }
  });
  const rankedByItem = new Map();
  Object.entries(rankData?.itemVendors || {}).forEach(([itemId, vendors]) => {
    const normalizedVendors = (Array.isArray(vendors) ? vendors : [])
      .map((vendor) => ({
        vendorId: String(vendor?.id || '').trim(),
        name: String(vendor?.name || '').trim(),
        unitPrice: vendor?.price,
        stock: vendor?.stock,
        unit: vendor?.unit,
        leadTime: vendor?.leadTime
      }))
      .filter((vendor) => Boolean(vendor.vendorId));
    rankedByItem.set(String(itemId), normalizedVendors);
  });
  return rankedByItem;
}

async function runTool(userId, toolName, args) {
  const flow = getFlowState(userId);

  if (toolName === 'search_products') {
    const normalizedQuery = String(
      args.query || args.productName || args.name || args.term || ''
    ).trim();
    const cacheKey = JSON.stringify({
      userId: String(userId || ''),
      q: normalizedQuery,
      category: String(args.category || ''),
      limit: Number(args.limit || 6),
      page: Number(args.page || 1)
    });
    const cached = searchProductsCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 30 * 1000) {
      return cached.payload;
    }

    const startedAt = Date.now();
    let items = [];
    let degraded = false;
    try {
      const products = await searchPlatformDiscoveryProducts({
        query: normalizedQuery,
        category: args.category,
        limit: Number(args.limit || 6)
      });
      items = (products || []).slice(0, args.limit).map((p) => ({
        productId: p.id,
        name: p.name,
        brand: p.brand || null,
        unit: p.unit || 'nos'
      }));
    } catch (searchError) {
      degraded = true;
      console.warn('[voice] search_products degraded fallback', {
        reason: searchError?.message || 'unknown'
      });
      const { data: fallbackProducts } = await supabase
        .from('products')
        .select(
          `
            id,
            name,
            category,
            unit,
            brand,
            updated_at,
            supplier_products!inner(count)
          `
        )
        .eq('status', 'approved')
        .eq('supplier_products.status', 'approved')
        .eq('supplier_products.is_active', true)
        .order('updated_at', { ascending: false })
        .limit(Math.max(6, Number(args.limit || 6)));
      items = (fallbackProducts || []).slice(0, args.limit).map((p) => ({
        productId: p.id,
        name: p.name,
        brand: p.brand || null,
        unit: p.unit || 'nos'
      }));
    }

    const payload = {
      ok: true,
      source: 'platform_product_discovery',
      degraded,
      elapsedMs: Date.now() - startedAt,
      items,
      flowStep: flow.step,
      nextStep: FLOW_STEPS.discovery,
      message:
        items.length > 0
          ? 'Products found. Tell me which product and quantity to add to cart.'
          : 'No exact match found. Ask user to choose from currently listed products in discovery.'
    };
    searchProductsCache.set(cacheKey, { savedAt: Date.now(), payload });
    if (searchProductsCache.size > 200) {
      const firstKey = searchProductsCache.keys().next().value;
      if (firstKey) searchProductsCache.delete(firstKey);
    }
    return payload;
  }

  if (toolName === 'add_discovery_line') {
    let resolvedProductId = String(args.productId || args.id || '').trim();
    if (!resolvedProductId && args.productName) {
      const lookup = await callInternalApi({
        userId,
        path: '/api/supplier/products/search',
        query: {
          q: String(args.productName).trim(),
          limit: 1,
          page: 1
        }
      });
      const best = Array.isArray(lookup?.suggestions) ? lookup.suggestions[0] : null;
      if (best?.id) {
        resolvedProductId = String(best.id);
      }
    }
    if (!resolvedProductId) {
      throw new Error('Could not resolve product to add. Please provide product id or clearer product name.');
    }

    const data = await callInternalApi({
      userId,
      method: 'POST',
      path: '/api/po/cart/discovery-item',
      body: {
        productId: resolvedProductId,
        quantity: args.quantity
      }
    });
    const latestCart = await callInternalApi({ userId, path: '/api/po/cart' });
    const cartSummary = summarizeCartForVoice(latestCart.cart);
    setFlowState(userId, FLOW_STEPS.cart_ready);
    return {
      ok: true,
      source: 'platform_product_discovery',
      message: data.message || 'Item added to cart.',
      cartItemCount: cartSummary.itemCount,
      cartItems: cartSummary.items,
      flowStep: FLOW_STEPS.cart_ready,
      nextStep: FLOW_STEPS.supplier_selection,
      nextAction: 'go_to_cart',
      promptHint: 'Tell user cart is updated and continue to cart review before supplier selection.'
    };
  }

  if (toolName === 'get_po_cart') {
    const data = await callInternalApi({ userId, path: '/api/po/cart' });
    const summary = summarizeCartForVoice(data.cart);
    if (summary.itemCount > 0) {
      setFlowState(userId, FLOW_STEPS.cart_ready);
    }
    return {
      ok: true,
      ...summary,
      flowStep: getFlowState(userId).step,
      nextStep: FLOW_STEPS.supplier_selection,
      message: 'Cart loaded. Confirm cart items first, then move to supplier selection.'
    };
  }

  if (toolName === 'update_cart_item_quantity') {
    const cartData = await callInternalApi({ userId, path: '/api/po/cart' });
    const draft = cartData?.cart?.draft || {};
    const items = extractDraftItems(draft);
    const resolvedItemId = resolveDraftItemId(args.itemId, items);
    const patchResult = await callInternalApi({
      userId,
      method: 'PATCH',
      path: `/api/po/cart/items/${encodeURIComponent(resolvedItemId)}/quantity`,
      body: { quantity: args.quantity }
    });
    return {
      ok: true,
      itemId: resolvedItemId,
      quantity: args.quantity,
      message: patchResult.message || 'Quantity updated. Ask if user wants supplier selection now.'
    };
  }

  if (toolName === 'list_suppliers_for_cart') {
    if (![FLOW_STEPS.cart_ready, FLOW_STEPS.supplier_selection, FLOW_STEPS.checkout_details, FLOW_STEPS.review_ready].includes(flow.step)) {
      return {
        ok: false,
        flowStep: flow.step,
        message: 'Please search and add at least one product to cart before supplier selection.'
      };
    }
    const cartData = await callInternalApi({ userId, path: '/api/po/cart' });
    const draft = cartData?.cart?.draft || {};
    const items = extractDraftItems(draft);
    if (!items.length) {
      return { ok: false, suggestions: [], message: 'Cart has no items yet.' };
    }
    const rankedByItem = await getAllowedVendorsByItem(userId, draft);
    const topPerItem = Number(args.topPerItem || 3);
    const suggestions = Array.from(rankedByItem.entries()).map(([itemId, vendors]) => ({
      itemId,
      vendors: (Array.isArray(vendors) ? vendors : [])
        .slice(0, topPerItem)
        .map((vendor, index) => ({
          optionIndex: index + 1,
          vendorId: vendor.vendorId,
          name: vendor.name || 'Platform supplier',
          unitPrice: vendor.unitPrice,
          stock: Number(vendor?.stock || 0) || 0,
          unit: vendor?.unit || 'unit',
          leadTimeDays: Number(vendor?.leadTime || 0) || null
        }))
    }));
    return {
      ok: true,
      suggestions,
      flowStep: FLOW_STEPS.supplier_selection,
      nextStep: FLOW_STEPS.supplier_selection,
      message: 'Supplier options prepared. Ask user to choose by option number, vendor name, or vendor id.'
    };
  }

  if (toolName === 'set_supplier_selections') {
    if (![FLOW_STEPS.cart_ready, FLOW_STEPS.supplier_selection].includes(flow.step)) {
      return {
        ok: false,
        flowStep: flow.step,
        message: 'Please add products to cart before selecting suppliers.'
      };
    }
    const cartData = await callInternalApi({ userId, path: '/api/po/cart' });
    const draft = cartData?.cart?.draft || {};
    const rankedByItem = await getAllowedVendorsByItem(userId, draft);
    const draftItems = extractDraftItems(draft);
    const itemIdSet = new Set(draftItems.map((item) => String(item?.id || '')));
    const invalidSelections = [];
    const resolvedSelections = [];

    (args.selections || []).forEach((selection) => {
      const itemId = resolveDraftItemId(selection?.itemId, draftItems);
      const supplierName = normalizeSupplierName(selection?.supplierName);
      const explicitVendorId = String(selection?.vendorId || '').trim();
      const optionIndex = Number(selection?.optionIndex || 0);
      if (!itemIdSet.has(itemId)) {
        invalidSelections.push({ itemId, reason: 'item_not_in_cart' });
        return;
      }
      const rankedVendors = rankedByItem.get(itemId) || [];
      let resolvedVendorId = '';

      if (explicitVendorId) {
        const idMatch = rankedVendors.find((vendor) => String(vendor.vendorId) === explicitVendorId);
        if (idMatch) resolvedVendorId = idMatch.vendorId;
      }
      if (!resolvedVendorId && optionIndex > 0 && optionIndex <= rankedVendors.length) {
        resolvedVendorId = rankedVendors[optionIndex - 1].vendorId;
      }
      if (!resolvedVendorId && supplierName) {
        const nameMatch = rankedVendors.find((vendor) => normalizeSupplierName(vendor.name) === supplierName);
        if (nameMatch) resolvedVendorId = nameMatch.vendorId;
      }
      if (!resolvedVendorId) {
        invalidSelections.push({ itemId, reason: 'supplier_not_found_for_item' });
        return;
      }
      resolvedSelections.push({ itemId, vendorId: resolvedVendorId });
    });

    if (invalidSelections.length) {
      throw new Error('Some supplier selections are invalid. Please choose from listed supplier options.');
    }

    const nextDraft = applySelectionsToDraft(draft, resolvedSelections);
    await callInternalApi({
      userId,
      method: 'PUT',
      path: '/api/po/cart',
      body: {
        selectedVendors: nextDraft.selectedVendors || {},
        substitutions: Array.isArray(nextDraft.substitutions) ? nextDraft.substitutions : [],
        items: Array.isArray(nextDraft.items) ? nextDraft.items : [],
        boqGroups: Array.isArray(nextDraft.boqGroups) ? nextDraft.boqGroups : [],
        boqId: nextDraft.boqId || null,
        boqProject: nextDraft.boqProject || null,
        requiredDate: nextDraft.requiredDate || null,
        paymentMethod: nextDraft.paymentMethod || null,
        deliveryDestination: nextDraft.deliveryDestination || null,
        shippingAddress: nextDraft.shippingAddress || null,
        billingAddress: nextDraft.billingAddress || null,
        gstin: nextDraft.gstin || null
      }
    });
    setFlowState(userId, FLOW_STEPS.supplier_selection);
    return {
      ok: true,
      selectedCount: Object.values(nextDraft.selectedVendors || {}).filter(Boolean).length,
      flowStep: FLOW_STEPS.supplier_selection,
      nextStep: FLOW_STEPS.checkout_details,
      message: 'Supplier selections saved. Continue to place-order details (required date, payment mode, shipping and billing addresses), then review.'
    };
  }

  if (toolName === 'build_po_preview') {
    if (![FLOW_STEPS.supplier_selection, FLOW_STEPS.checkout_details, FLOW_STEPS.review_ready].includes(flow.step)) {
      return {
        ok: false,
        flowStep: flow.step,
        message: 'Please complete supplier selection before preview.'
      };
    }
    const cartData = await callInternalApi({ userId, path: '/api/po/cart' });
    const draft = cartData?.cart?.draft || {};
    const grouped = await callInternalApi({
      userId,
      method: 'POST',
      path: '/api/po/group',
      body: buildPoGroupRequestFromDraft(draft)
    });
    const groups = Array.isArray(grouped.groups) ? grouped.groups : [];
    setFlowState(userId, FLOW_STEPS.review_ready);
    return {
      ok: true,
      groupCount: groups.length,
      groups: groups.map((group) => ({
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        itemCount: Array.isArray(group.items) ? group.items.length : 0,
        total: Number(group.total || 0)
      })),
      flowStep: FLOW_STEPS.review_ready,
      nextStep: FLOW_STEPS.review_ready,
      message: 'PO review is ready. Read back full order details and place only after explicit confirmation.'
    };
  }

  if (toolName === 'get_checkout_defaults') {
    if (![FLOW_STEPS.supplier_selection, FLOW_STEPS.checkout_details, FLOW_STEPS.review_ready].includes(flow.step)) {
      return {
        ok: false,
        flowStep: flow.step,
        message: 'Please complete supplier selection before collecting checkout details.'
      };
    }
    const profileData = await callInternalApi({ userId, path: '/api/profile' });
    const profile = profileData.profile || {};
    setFlowState(userId, FLOW_STEPS.checkout_details);
    return {
      ok: true,
      shippingAddress: profile.address || null,
      billingAddresses: Array.isArray(profile.billingAddresses) ? profile.billingAddresses : [],
      gstin: profile.gstin || null,
      flowStep: FLOW_STEPS.checkout_details,
      nextStep: FLOW_STEPS.review_ready,
      message: 'Checkout defaults fetched.'
    };
  }

  if (toolName === 'place_purchase_orders') {
    if (flow.step !== FLOW_STEPS.review_ready) {
      throw new Error('Please complete order review before placing the order.');
    }
    if (!args.confirmed) {
      throw new Error('Explicit confirmation is required before placing order.');
    }
    const paymentMethod = args.paymentMethod || 'cod';
    if (!args.requiredDate || !String(args.requiredDate).trim()) {
      throw new Error('Required date is mandatory before placing order.');
    }
    if (!isAddressComplete(args.shippingAddress)) {
      throw new Error('Complete shipping address is mandatory before placing order.');
    }
    if (!isAddressComplete(args.billingAddress)) {
      throw new Error('Complete billing address is mandatory before placing order.');
    }

    const idempotencyKey = args.clientRequestId
      ? `${userId}:${String(args.clientRequestId).trim().toLowerCase()}`
      : null;
    if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
      return idempotencyCache.get(idempotencyKey);
    }

    const cartData = await callInternalApi({ userId, path: '/api/po/cart' });
    const draft = cartData?.cart?.draft || {};
    const items = extractDraftItems(draft);
    if (!items.length) {
      throw new Error('Cannot place order: cart is empty.');
    }

    const grouped = await callInternalApi({
      userId,
      method: 'POST',
      path: '/api/po/group',
      body: buildPoGroupRequestFromDraft(draft)
    });
    const poGroups = Array.isArray(grouped.groups) ? grouped.groups : [];
    if (!poGroups.length) {
      throw new Error('No supplier groups available. Please select suppliers first.');
    }

    const createResponse = await callInternalApi({
      userId,
      method: 'POST',
      path: '/api/po/create',
      body: {
        poGroups,
        boqId: args.boqId || null,
        requiredDate: args.requiredDate || null,
        paymentMethod,
        deliveryDestination: args.deliveryDestination || 'shipping',
        shippingAddress: args.shippingAddress || draft.shippingAddress || undefined,
        billingAddress: args.billingAddress || draft.billingAddress || undefined,
        gstin: args.gstin || draft.gstin || null
      }
    });

    const result = {
      ok: true,
      message: createResponse.message || 'Purchase order created successfully.',
      ordersCreated: Array.isArray(createResponse.orders) ? createResponse.orders.length : undefined
    };

    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, result);
      setTimeout(() => idempotencyCache.delete(idempotencyKey), 30 * 60 * 1000);
    }
    setFlowState(userId, FLOW_STEPS.discovery);
    return result;
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

router.post('/session', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const parsedRequest = parseWithSchema(voiceSessionRequestSchema, req.body || {});
    const { token, expiresAt } = issueVoiceSessionToken(req.userId);
    rememberVoiceSession(req.userId, token, expiresAt);
    rememberVoicePageContext(req.userId, parsedRequest?.pageContext);
    console.info('[voice] session created', {
      userId: req.userId,
      assistantConfigured: Boolean(VAPI_ASSISTANT_ID),
      publicKeyConfigured: Boolean(VAPI_PUBLIC_KEY),
      expiresAt
    });
    return res.json({
      status: 'success',
      voiceSessionToken: token,
      expiresAt,
      assistantId: VAPI_ASSISTANT_ID || null,
      publicKey: VAPI_PUBLIC_KEY || null
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to create voice session' });
  }
});

router.post('/tool', async (req, res) => {
  try {
    console.info('[voice] webhook received', {
      hasSecretHeader: Boolean(req.headers['x-vapi-secret']),
      bodyType: req.body?.message?.type || req.body?.type || 'unknown'
    });
    if (VAPI_WEBHOOK_SECRET) {
      const incoming = req.headers['x-vapi-secret'];
      if (String(incoming || '') !== String(VAPI_WEBHOOK_SECRET)) {
        if (ALLOW_INSECURE_VAPI_WEBHOOK) {
          console.warn('[voice] x-vapi-secret mismatch. Allowing because insecure webhook mode is enabled.');
        } else {
        return res.status(401).json({ status: 'error', message: 'Invalid Vapi webhook secret' });
        }
      }
    }

    const payload = parseWithSchema(vapiServerMessageSchema, req.body || {});
    const message = payload.message || {};
    const toolCalls = collectToolCalls(message);
    if (toolCalls.length === 0) {
      console.info('[voice] no tool calls in message', {
        messageType: String(message.type || 'unknown')
      });
      return res.json({ results: [] });
    }

    let userId = '';
    try {
      userId = resolveUserIdFromToolRequest(req.body || {}, message);
    } catch (resolveError) {
      console.warn('[voice] tool-calls user resolution failed', {
        messageType: String(message.type || 'unknown'),
        reason: resolveError?.message || 'unknown',
        topLevelKeys: Object.keys(req.body || {}),
        messageKeys: Object.keys(message || {}),
        hasCallMetadata: Boolean(message?.call?.metadata),
        hasMessageMetadata: Boolean(message?.metadata),
        hasRootMetadata: Boolean(req.body?.metadata),
        callId: String(message?.call?.id || req.body?.call?.id || ''),
        toolCallCount: toolCalls.length
      });
      return res.status(401).json({ status: 'error', message: resolveError?.message || 'Invalid voice session' });
    }
    console.info('[voice] tool calls parsed', {
      count: toolCalls.length,
      names: toolCalls.map((toolCall) => toolCall?.function?.name || toolCall?.name).filter(Boolean)
    });
    const results = [];

    for (const toolCall of toolCalls) {
      const toolCallId = toolCall.toolCallId || toolCall.id;
      const fnName = toolCall?.function?.name || toolCall?.name;
      const rawArgs = toolCall?.function?.arguments ?? toolCall?.arguments ?? {};
      if (!fnName) {
        results.push({
          toolCallId,
          result: JSON.stringify({ ok: false, error: 'Missing tool function name' })
        });
        continue;
      }

      const schema = voiceToolArgsByName[fnName];
      if (!schema) {
        results.push({
          toolCallId,
          result: JSON.stringify({ ok: false, error: `Unknown tool: ${fnName}` })
        });
        continue;
      }

      try {
        const args = schema.parse(parseToolArguments(rawArgs));
        const toolResult = await runTool(userId, fnName, args);
        const responsePayload =
          toolResult && typeof toolResult === 'object'
            ? {
                ...toolResult,
                uiContext: getVoicePageContext(userId)
              }
            : toolResult;
        results.push({
          name: fnName,
          toolCallId,
          result: JSON.stringify(responsePayload)
        });
      } catch (toolError) {
        results.push({
          name: fnName,
          toolCallId,
          result: JSON.stringify({ ok: false, error: toolError.message || 'Tool execution failed' })
        });
      }
    }

    return res.json({ results });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[voice] webhook processing error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process tool calls' });
  }
});

export { router as voiceRouter };
