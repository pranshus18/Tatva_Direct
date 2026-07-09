import {
  rankProductsByQuery,
  filterByFuzzyScore,
  shouldRunFuzzyFallback,
  mergeRankedProducts,
  FUZZY_MATCH_MIN_SCORE,
  buildTokenIlikePatterns
} from './productDiscoveryFuzzyRank.js';
import { normalizeSearchQueryAliases } from './voiceSearchAliases.js';
import { enrichProductsWithOfferImages } from './productImageService.js';
import {
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  aggregateEligibleDiscoveryOffers,
  reconcileDiscoveryProductFields,
  syncCatalogProductSnapshotFromOffers
} from './catalogOfferSnapshotService.js';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';

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

/**
 * Product Discovery search (listed approved products + supplier offers).
 *
 * @param {boolean} [legacyManualDiscoveryCategoryFilter] - When true, uses the original browser
 *   API behaviour: `category` query param is lowercased and matched with `.eq` (manual Product Discovery).
 *   When false, category is matched case-insensitively (ILike).
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
    legacyManualDiscoveryCategoryFilter = false
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

  const query = sanitizeDiscoverySearchQuery(normalizeSearchQueryAliases(sanitizeDiscoverySearchQuery(q)));
  const rankingPoolLimit = query ? 250 : 500;
  const trimmedCategory = String(category || '').trim();

  const categoryOpts = {
    trimmedCategory
  };

  let productsQuery = applyTextSearchFilter(
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

  if (query && !rankedPool.length) {
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

  if (query && shouldRunFuzzyFallback(query, rankedPool, safeLimit)) {
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

  const productsWithImages = await enrichProductsWithOfferImages(supabase, rawProducts || []);
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
  const discoveryBrandCandidates = productsWithImages.map((p) => detectDiscoveryBrand(p)).filter(Boolean);
  const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, discoveryBrandCandidates);
  const productIds = productsWithImages.map((p) => p?.id).filter(Boolean);
  const productById = new Map(productsWithImages.map((p) => [p?.id, p]));
  let offerAggregates = {
    eligibleSupplierCountByProduct: new Map(),
    totalStockByProduct: new Map(),
    bestOfferByProduct: new Map()
  };
  if (productIds.length > 0) {
    const { data: offerRows } = await supabase
      .from('supplier_products')
      .select(
        'product_id, price, stock, min_order_quantity, location, status, is_active, supplier:users!supplier_products_supplier_id_fkey(profile)'
      )
      .in('product_id', productIds)
      .neq('status', 'rejected');

    offerAggregates = aggregateEligibleDiscoveryOffers({
      offerRows: offerRows || [],
      productById,
      detectDiscoveryBrand,
      terminalRoleByBrandMap,
      supplierMatchesBrandTerminalRoleFn: supplierMatchesBrandTerminalRole
    });
  }

  const suggestions = productsWithImages
    .map((p) => {
      const categoryKey = String(p?.category || '').trim().toLowerCase();
      const affinityScore = categoryAffinity.get(categoryKey) || 0;
      const recommendationScore = Number(affinityScore.toFixed(3));
      return {
        ...reconcileDiscoveryProductFields(p, offerAggregates),
        recommendationScore
      };
    })
    .filter((p) => Number(p?.supplierCount || 0) > 0);

  for (const suggestion of suggestions) {
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

  suggestions.sort((a, b) => {
    if (query) {
      const matchDiff = (b.matchScore || 0) - (a.matchScore || 0);
      if (
        matchDiff !== 0 &&
        (b.matchScore >= FUZZY_MATCH_MIN_SCORE || a.matchScore >= FUZZY_MATCH_MIN_SCORE)
      ) {
        return matchDiff;
      }
    }

    const scoreDiff = (b.recommendationScore || 0) - (a.recommendationScore || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const supplierDiff = (Number(b.supplierCount) || 0) - (Number(a.supplierCount) || 0);
    if (supplierDiff !== 0) return supplierDiff;

    const aUpdated = Date.parse(a?.updated_at || 0) || 0;
    const bUpdated = Date.parse(b?.updated_at || 0) || 0;
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;

    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

  const categories = Array.from(
    new Set(
      suggestions
        .map((product) => String(product?.category || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const paginatedSuggestions = suggestions.slice(offset, offset + safeLimit);

  return {
    suggestions: paginatedSuggestions,
    categories,
    total: suggestions.length,
    limit: safeLimit,
    offset,
    recommendationMode: 'personalized-order-affinity'
  };
}
