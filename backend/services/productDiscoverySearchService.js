import {
  rankProductsByQuery,
  filterByFuzzyScore,
  shouldRunFuzzyFallback,
  mergeRankedProducts,
  FUZZY_MATCH_MIN_SCORE,
  buildTokenIlikePatterns
} from './productDiscoveryFuzzyRank.js';
import { normalizeSearchQueryAliases } from './voiceSearchAliases.js';
import {
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  aggregateEligibleDiscoveryOffers,
  reconcileDiscoveryProductFields,
  syncCatalogProductSnapshotFromOffers
} from './catalogOfferSnapshotService.js';
import { enrichDiscoveryOffersWithBuyerBcov } from './discoveryBcovPricingService.js';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { dedupeCategoryStrings } from '../utils/categoryNormalize.js';
import { enrichDiscoverySuggestionsWithVariantCounts } from './productDiscoveryDetailService.js';
import { normalizeText } from './supplierCatalogHelpersService.js';
import { extractTokens } from './textMatchingService.js';
import { resolveSellerOwnedListingImages } from './productImageService.js';

/** Stable discovery ordering: relevance when searching, otherwise alphabetical by name. */
export function sortDiscoverySuggestions(products = [], { query = '' } = {}) {
  const hasQuery = Boolean(String(query || '').trim());
  return [...products].sort((a, b) => {
    if (hasQuery) {
      const matchDiff = (b.matchScore || 0) - (a.matchScore || 0);
      if (
        matchDiff !== 0 &&
        (b.matchScore >= FUZZY_MATCH_MIN_SCORE || a.matchScore >= FUZZY_MATCH_MIN_SCORE)
      ) {
        return matchDiff;
      }
    }

    const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
      sensitivity: 'base'
    });
    if (nameDiff !== 0) return nameDiff;

    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

/**
 * PostgREST `.or('a.ilike.%x%,b.ilike.%x%')` treats commas as delimiters; commas/parens in the
 * pattern can break the filter. Strip LIKE wildcards so user input cannot broaden matches.
 */
export function sanitizeDiscoverySearchQuery(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/[,()[\]]/g, ' ').replace(/%/g, ' ').replace(/_/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

/** Escape `%`, `_`, `\` for use as an ILIKE literal (no wildcards added). */
function escapeIlikeLiteral(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function applyCategoryFilter(productsQuery, { trimmedCategory }) {
  if (!trimmedCategory) return productsQuery;
  return productsQuery.ilike('category', escapeIlikeLiteral(trimmedCategory));
}

function buildListedProductsQuery(supabase, categoryOpts) {
  let productsQuery = supabase
    .from('products')
    .select(
      `
          id,
          name,
          category,
          unit,
          description,
          brand,
          gtin,
          barcode,
          specifications,
          images,
          price,
          stock,
          min_order_quantity,
          average_rating,
          total_reviews,
          tags,
          location,
          status,
          is_active,
          updated_at,
          family_id,
          variant_id,
          asin,
          supplier_products(count)
        `,
      { count: 'exact' }
    )
    .eq('status', 'approved')
    .or('is_active.eq.true,is_active.is.null');

  return applyCategoryFilter(productsQuery, categoryOpts);
}

function applyTextSearchFilter(productsQuery, query) {
  if (!query) return productsQuery;
  const ilikeQuery = `%${escapeIlikeLiteral(query).replace(/\s+/g, '%')}%`;
  return productsQuery.or(
    `name.ilike.${ilikeQuery},brand.ilike.${ilikeQuery},description.ilike.${ilikeQuery},category.ilike.${ilikeQuery}`
  );
}

/** Add Product name dropdown: only match catalog name/brand — never description/category noise. */
function applyCatalogAutocompleteTextFilter(productsQuery, query) {
  if (!query) return productsQuery;
  const ilikeQuery = `%${escapeIlikeLiteral(query).replace(/\s+/g, '%')}%`;
  return productsQuery.or(`name.ilike.${ilikeQuery},brand.ilike.${ilikeQuery}`);
}

/**
 * Keep autocomplete rows that actually look like the typed product/variant name.
 * Completely new names (no DB hit) must yield an empty dropdown.
 */
export function filterCatalogAutocompleteNameMatches(query, suggestions = []) {
  const q = sanitizeDiscoverySearchQuery(String(query || ''));
  if (!q) return [];
  const qNorm = normalizeText(q);
  if (!qNorm) return [];
  const qTokens = extractTokens(qNorm).filter((t) => t.length >= 2);

  const matched = (suggestions || []).filter((row) => {
    const nameNorm = normalizeText(row?.name || '');
    const brandNorm = normalizeText(row?.brand || '');
    const haystack = [nameNorm, brandNorm, `${brandNorm} ${nameNorm}`].filter(Boolean).join(' ');
    if (!haystack) return false;
    if (haystack.includes(qNorm) || nameNorm.includes(qNorm)) return true;
    if (qNorm.length >= 4 && nameNorm.startsWith(qNorm.slice(0, Math.min(qNorm.length, 12)))) {
      return true;
    }
    if (qTokens.length === 0) return false;
    // Require every meaningful token to appear in name or brand (not description).
    return qTokens.every((token) => nameNorm.includes(token) || brandNorm.includes(token));
  });

  const qFirst = qTokens[0] || '';
  if (qFirst.length < 3) return matched;
  const queryNamesAListedBrand = (suggestions || []).some((row) => {
    const brandFirst =
      extractTokens(normalizeText(row?.brand || '')).filter((token) => token.length >= 2)[0] || '';
    return brandFirst === qFirst;
  });
  if (!queryNamesAListedBrand) return matched;
  return matched.filter((row) => {
    const brandFirst =
      extractTokens(normalizeText(row?.brand || '')).filter((token) => token.length >= 2)[0] || '';
    const nameNorm = normalizeText(row?.name || '');
    return brandFirst === qFirst || nameNorm === qFirst || nameNorm.startsWith(`${qFirst} `);
  });
}

function applyTokenSearchFilter(productsQuery, query) {
  const patterns = buildTokenIlikePatterns(query);
  if (!patterns.length) return productsQuery;

  const parts = [];
  for (const pattern of patterns) {
    const escaped = pattern.replace(/,/g, ' ');
    parts.push(
      `name.ilike.${escaped}`,
      `brand.ilike.${escaped}`,
      `description.ilike.${escaped}`,
      `category.ilike.${escaped}`
    );
  }
  return productsQuery.or(parts.slice(0, 16).join(','));
}

const OWNED_PRODUCT_SELECT = `
  id,
  name,
  category,
  unit,
  description,
  brand,
  gtin,
  barcode,
  specifications,
  images,
  price,
  stock,
  min_order_quantity,
  average_rating,
  total_reviews,
  tags,
  location,
  status,
  is_active,
  updated_at,
  family_id,
  variant_id,
  asin
`;

/**
 * Catalog rows this supplier already listed (pending or approved).
 * Used by Product Management autocomplete so suppliers can re-select their own
 * submissions even before admin approval — discovery search only returns approved listed SKUs.
 */
export async function searchSupplierOwnedCatalogSuggestions(
  supabase,
  { supplierId, q, category, limit = 50, strictNameMatch = false } = {}
) {
  const ownerId = String(supplierId || '').trim();
  if (!ownerId) return [];

  const parsedLimit = Number.parseInt(String(limit ?? ''), 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 50;
  const query = sanitizeDiscoverySearchQuery(
    normalizeSearchQueryAliases(sanitizeDiscoverySearchQuery(q))
  );
  const trimmedCategory = String(category || '').trim();

  const { data: offerRows, error: offerError } = await supabase
    .from('supplier_products')
    .select('product_id, status, updated_at')
    .eq('supplier_id', ownerId)
    .neq('status', 'rejected')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (offerError) throw offerError;

  const productIds = [
    ...new Set((offerRows || []).map((row) => row?.product_id).filter(Boolean).map(String))
  ];
  if (productIds.length === 0) return [];

  const offerStatusByProductId = new Map();
  for (const row of offerRows || []) {
    const productId = String(row?.product_id || '').trim();
    if (!productId || offerStatusByProductId.has(productId)) continue;
    offerStatusByProductId.set(productId, String(row?.status || 'pending').trim().toLowerCase());
  }

  const chunkSize = 100;
  const products = [];
  const textFilter = strictNameMatch ? applyCatalogAutocompleteTextFilter : applyTextSearchFilter;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    let productsQuery = applyCategoryFilter(
      supabase
        .from('products')
        .select(OWNED_PRODUCT_SELECT)
        .in('id', chunk)
        .neq('status', 'rejected'),
      { trimmedCategory }
    );
    productsQuery = textFilter(productsQuery, query);

    const { data: rows, error: productsError } = await productsQuery
      .order('updated_at', { ascending: false })
      .limit(safeLimit);
    if (productsError) throw productsError;
    products.push(...(rows || []));
  }

  let ranked = rankProductsByQuery(query, products);
  // Never fuzzy-expand for Add Product autocomplete — new names must return empty.
  if (query && !ranked.length && products.length === 0 && !strictNameMatch) {
    // Text search may miss fuzzy short names — fall back to ranking the full owned set.
    const fallback = [];
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      let fallbackQuery = applyCategoryFilter(
        supabase.from('products').select(OWNED_PRODUCT_SELECT).in('id', chunk).neq('status', 'rejected'),
        { trimmedCategory }
      );
      const { data: rows, error } = await fallbackQuery
        .order('updated_at', { ascending: false })
        .limit(250);
      if (error) throw error;
      fallback.push(...(rows || []));
    }
    ranked = filterByFuzzyScore(rankProductsByQuery(query, fallback), { limit: safeLimit });
  }

  const byId = new Map();
  for (const product of ranked.length ? ranked : products) {
    const id = String(product?.id || '').trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      ...product,
      supplierCount: 1,
      canAddToCart: false,
      ownedBySupplier: true,
      offerStatus: offerStatusByProductId.get(id) || String(product?.status || 'pending').toLowerCase()
    });
  }

  const sorted = sortDiscoverySuggestions([...byId.values()], { query }).slice(0, safeLimit);
  return strictNameMatch ? filterCatalogAutocompleteNameMatches(query, sorted) : sorted;
}

/**
 * Union approved discovery hits with the supplier's own catalog rows (dedupe by product id).
 * Owned rows win on conflict so pending submissions remain visible in Product Management.
 */
export function mergeOwnedIntoDiscoverySuggestions(
  discoverySuggestions = [],
  ownedSuggestions = [],
  { query = '' } = {}
) {
  const byId = new Map();

  for (const suggestion of discoverySuggestions || []) {
    const id = String(suggestion?.id || '').trim();
    if (!id) continue;
    byId.set(id, suggestion);
  }

  for (const suggestion of ownedSuggestions || []) {
    const id = String(suggestion?.id || '').trim();
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, existing
      ? {
          ...existing,
          ...suggestion,
          ownedBySupplier: true,
          supplierCount: Math.max(
            Number(existing?.supplierCount) || 0,
            Number(suggestion?.supplierCount) || 1
          )
        }
      : { ...suggestion, ownedBySupplier: true });
  }

  return sortDiscoverySuggestions([...byId.values()], { query });
}

const FAMILY_SIBLING_SELECT = `
  id,
  name,
  category,
  unit,
  description,
  brand,
  gtin,
  barcode,
  specifications,
  images,
  price,
  stock,
  min_order_quantity,
  average_rating,
  total_reviews,
  tags,
  location,
  status,
  is_active,
  updated_at,
  family_id,
  variant_id,
  asin
`;

/**
 * When a search hit is one variant of a family, include sibling catalog rows so a
 * retailer who already sells Blue still sees Red on Product Discovery.
 */
export async function attachFamilySiblingProducts(supabase, products = []) {
  const list = Array.isArray(products) ? products : [];
  const familyIds = [...new Set(list.map((product) => product?.family_id).filter(Boolean))];
  if (!familyIds.length) return list;

  const { data: siblings, error } = await supabase
    .from('products')
    .select(FAMILY_SIBLING_SELECT)
    .in('family_id', familyIds)
    .eq('status', 'approved')
    .or('is_active.eq.true,is_active.is.null');
  if (error || !Array.isArray(siblings) || siblings.length === 0) {
    if (error) {
      console.error(
        '[DiscoverySearch] family sibling lookup failed:',
        error.message || error
      );
    }
    return list;
  }

  const familyScore = new Map();
  for (const product of list) {
    if (!product?.family_id) continue;
    familyScore.set(
      product.family_id,
      Math.max(familyScore.get(product.family_id) || 0, Number(product.matchScore) || 0)
    );
  }

  const byId = new Map(list.map((product) => [product.id, product]));
  for (const row of siblings) {
    if (!row?.id || byId.has(row.id)) continue;
    byId.set(row.id, {
      ...row,
      matchScore: familyScore.get(row.family_id) || 0
    });
  }
  return [...byId.values()];
}

/**
 * Product Discovery search (listed approved products + supplier offers).
 *
 * @param {boolean} [legacyManualDiscoveryCategoryFilter] - When true, uses the original browser
 *   API behaviour: `category` query param is lowercased and matched with `.eq` (manual Product Discovery).
 *   When false, category is matched case-insensitively (ILike).
 * @param {boolean} [forCatalogAutocomplete] - When true (supplier Add Product name suggestions),
 *   return every matching approved catalog product even if it currently has no live eligible offers.
 *   Buyers still require supplierCount > 0 so they only see purchasable listings.
 */
export async function searchProductDiscoveryForUser(
  supabase,
  {
    userId,
    q,
    category,
    limit,
    page,
    offset: offsetOverride,
    legacyManualDiscoveryCategoryFilter = false,
    forCatalogAutocomplete = false,
    excludeSupplierId: excludeSupplierIdOption
  }
) {
  const parsedLimit = Number.parseInt(String(limit ?? ''), 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
  const parsedPage = Number.parseInt(String(page ?? ''), 10);
  const safePage = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1;
  const parsedOffset = Number.parseInt(String(offsetOverride ?? ''), 10);
  const offset = Number.isFinite(parsedOffset)
    ? Math.max(parsedOffset, 0)
    : (safePage - 1) * safeLimit;
  const excludeSupplierId =
    excludeSupplierIdOption === undefined
      ? forCatalogAutocomplete
        ? null
        : userId
      : excludeSupplierIdOption;

  const query = sanitizeDiscoverySearchQuery(normalizeSearchQueryAliases(sanitizeDiscoverySearchQuery(q)));
  const rankingPoolLimit = query ? 250 : 500;
  const trimmedCategory = String(category || '').trim();

  const categoryOpts = {
    trimmedCategory
  };

  const textFilter = forCatalogAutocomplete
    ? applyCatalogAutocompleteTextFilter
    : applyTextSearchFilter;

  let productsQuery = textFilter(
    buildListedProductsQuery(supabase, categoryOpts),
    query
  );

  let { data: rawProducts, error, count } = await productsQuery
    .order('updated_at', { ascending: false })
    .limit(rankingPoolLimit);

  if (error) {
    throw error;
  }

  let rankedPool = rankProductsByQuery(query, rawProducts || []);

  // Buyer/voice search may broaden with token + fuzzy fallbacks.
  // Add Product autocomplete must only return real catalog name/brand hits.
  if (query && !rankedPool.length && !forCatalogAutocomplete) {
    const tokenQuery = applyTokenSearchFilter(
      buildListedProductsQuery(supabase, categoryOpts),
      query
    );
    const tokenRes = await tokenQuery.order('updated_at', { ascending: false }).limit(rankingPoolLimit);
    if (!tokenRes.error && tokenRes.data?.length) {
      rankedPool = mergeRankedProducts(rankedPool, rankProductsByQuery(query, tokenRes.data));
      rawProducts = mergeRankedProducts(rawProducts || [], tokenRes.data);
      count = Math.max(Number(count) || 0, tokenRes.data.length);
    }
  }

  if (query && !forCatalogAutocomplete && shouldRunFuzzyFallback(query, rankedPool, safeLimit)) {
    const fallbackQuery = buildListedProductsQuery(supabase, categoryOpts);
    const fallbackRes = await fallbackQuery
      .order('updated_at', { ascending: false })
      .limit(rankingPoolLimit);

    if (!fallbackRes.error && fallbackRes.data?.length) {
      const fuzzyHits = filterByFuzzyScore(rankProductsByQuery(query, fallbackRes.data), {
        limit: rankingPoolLimit
      });
      rankedPool = mergeRankedProducts(rankedPool, fuzzyHits);
      const byId = new Map((rawProducts || []).map((p) => [p.id, p]));
      for (const p of fuzzyHits) {
        byId.set(p.id, { ...byId.get(p.id), ...p });
      }
      rawProducts = [...byId.values()];
      count = Math.max(Number(count) || 0, rawProducts.length);
    }
  }

  const rankedById = new Map(rankedPool.map((p) => [p.id, p.matchScore || 0]));
  rawProducts = (rawProducts || []).map((p) => ({
    ...p,
    matchScore: rankedById.get(p.id) ?? p.matchScore ?? 0
  }));

  if (query && rankedPool.length) {
    const orderIds = new Set(rankedPool.map((p) => p.id));
    rawProducts.sort((a, b) => {
      const scoreDiff = (b.matchScore || 0) - (a.matchScore || 0);
      if (scoreDiff !== 0 && (b.matchScore >= FUZZY_MATCH_MIN_SCORE || a.matchScore >= FUZZY_MATCH_MIN_SCORE)) {
        return scoreDiff;
      }
      if (orderIds.has(a.id) !== orderIds.has(b.id)) {
        return orderIds.has(b.id) ? 1 : -1;
      }
      return 0;
    });
  }

  const { data: recentOrders } = await supabase
    .from('orders')
    .select('id')
    .eq('service_provider_id', userId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(200);

  const recentOrderIds = (recentOrders || []).map((order) => order?.id).filter(Boolean);
  const categoryAffinity = new Map();

  if (recentOrderIds.length > 0) {
    const { data: orderItems } = await supabase
      .from('order_items')
      .select(`
          product_id,
          quantity,
          product:products (
            category
          )
        `)
      .in('order_id', recentOrderIds)
      .limit(3000);

    for (const item of orderItems || []) {
      const quantity = Math.max(1, Number.parseInt(String(item?.quantity || '1'), 10) || 1);
      const categoryKey = String(item?.product?.category || '').trim().toLowerCase();
      if (categoryKey) {
        categoryAffinity.set(categoryKey, (categoryAffinity.get(categoryKey) || 0) + quantity);
      }
    }
  }

  const listedProducts = forCatalogAutocomplete
    ? rawProducts || []
    : await attachFamilySiblingProducts(supabase, rawProducts || []);
  const detectDiscoveryBrand = (product = {}) => {
    const specs =
      product?.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications)
        ? product.specifications
        : {};
    return (
      product?.brand ||
      specs?.brand ||
      specs?.brandModel ||
      specs?.modelBrand ||
      ''
    );
  };
  const discoveryBrandCandidates = listedProducts.map((p) => detectDiscoveryBrand(p)).filter(Boolean);
  const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, discoveryBrandCandidates);
  const productIds = listedProducts.map((p) => p?.id).filter(Boolean);
  const productById = new Map(listedProducts.map((p) => [p?.id, p]));
  let offerAggregates = {
    eligibleSupplierCountByProduct: new Map(),
    totalStockByProduct: new Map(),
    bestOfferByProduct: new Map()
  };
  let pricedOfferRows = [];
  if (productIds.length > 0) {
    const { data: offerRows } = await supabase
      .from('supplier_products')
      .select(
        'id, product_id, supplier_id, price, stock, min_order_quantity, location, status, is_active, variant_key, variant_asin, attributes, supplier:users!supplier_products_supplier_id_fkey(id, profile)'
      )
      .in('product_id', productIds)
      .neq('status', 'rejected');

    const bcovResult = await enrichDiscoveryOffersWithBuyerBcov({
      supabase,
      userId,
      offerRows: offerRows || [],
      productById,
      enabled: !forCatalogAutocomplete && Boolean(userId)
    });
    pricedOfferRows = bcovResult.offerRows || [];

    offerAggregates = aggregateEligibleDiscoveryOffers({
      offerRows: pricedOfferRows,
      productById,
      detectDiscoveryBrand,
      terminalRoleByBrandMap,
      supplierMatchesBrandTerminalRoleFn: supplierMatchesBrandTerminalRole,
      excludeSupplierId
    });
  }

  const offersByProductId = new Map();
  for (const row of pricedOfferRows) {
    const productId = row?.product_id;
    if (!productId) continue;
    if (!offersByProductId.has(productId)) offersByProductId.set(productId, []);
    offersByProductId.get(productId).push(row);
  }

  const suggestions = listedProducts
    .map((p) => {
      const categoryKey = String(p?.category || '').trim().toLowerCase();
      const affinityScore = categoryAffinity.get(categoryKey) || 0;
      const recommendationScore = Number(affinityScore.toFixed(3));
      const reconciled = reconcileDiscoveryProductFields(p, offerAggregates);
      const productOffers = offersByProductId.get(p.id) || [];
      const images = resolveSellerOwnedListingImages({
        offer: offerAggregates.bestOfferByProduct.get(p.id) || null,
        catalogProductOffers: productOffers,
        catalogImages: p?.images
      });
      let listingImages = images;
      if (!listingImages.length) {
        for (const row of productOffers) {
          listingImages = resolveSellerOwnedListingImages({
            offer: row,
            catalogProductOffers: productOffers,
            catalogImages: p?.images
          });
          if (listingImages.length) break;
        }
      }
      return {
        ...reconciled,
        images: listingImages,
        recommendationScore
      };
    })
    // Buyer discovery: only purchasable listed offers.
    // Catalog autocomplete: keep all matching approved products so suppliers can reuse details.
    .filter((p) => forCatalogAutocomplete || Number(p?.supplierCount || 0) > 0);

  const suggestionsWithVariants = await enrichDiscoverySuggestionsWithVariantCounts(
    supabase,
    suggestions,
    { excludeSupplierId }
  );

  for (const suggestion of suggestionsWithVariants) {
    const catalogStock = parseSupplierStockQuantity(
      productById.get(suggestion?.id)?.stock
    ) ?? 0;
    const reconciledStock = parseSupplierStockQuantity(suggestion?.stock) ?? 0;
    if (reconciledStock !== catalogStock) {
      void syncCatalogProductSnapshotFromOffers(supabase, suggestion.id).catch((syncError) => {
        console.error('[CatalogSnapshot] discovery heal sync failed:', syncError?.message || syncError);
      });
    }
  }

  const sortedSuggestions = sortDiscoverySuggestions(
    forCatalogAutocomplete
      ? filterCatalogAutocompleteNameMatches(query, suggestionsWithVariants)
      : suggestionsWithVariants,
    { query }
  );

  const categories = dedupeCategoryStrings(
    sortedSuggestions.map((product) => product?.category)
  );

  const paginatedSuggestions = sortedSuggestions.slice(offset, offset + safeLimit);

  return {
    suggestions: paginatedSuggestions,
    categories,
    total: sortedSuggestions.length,
    limit: safeLimit,
    offset,
    recommendationMode: query ? 'search-relevance' : 'name-asc'
  };
}
