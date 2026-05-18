import {
  LISTED_SUPPLIER_PRODUCTS_OR,
  listedSupplierProductsFilterOptions
} from '../utils/platformListedSupplierProductsFilter.js';
import {
  rankProductsByQuery,
  filterByFuzzyScore,
  shouldRunFuzzyFallback,
  mergeRankedProducts,
  FUZZY_MATCH_MIN_SCORE,
  buildTokenIlikePatterns
} from './productDiscoveryFuzzyRank.js';
import { normalizeSearchQueryAliases } from './voiceSearchAliases.js';

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

function applyCategoryFilter(
  productsQuery,
  { legacyCategory, normalizedCategoryLegacy, trimmedCategoryVoice }
) {
  if (legacyCategory) {
    if (normalizedCategoryLegacy) {
      return productsQuery.eq('category', normalizedCategoryLegacy);
    }
    return productsQuery;
  }
  if (trimmedCategoryVoice) {
    return productsQuery.ilike('category', escapeIlikeLiteral(trimmedCategoryVoice));
  }
  return productsQuery;
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
          status,
          is_active,
          updated_at,
          supplier_products!inner(count)
        `,
      { count: 'exact' }
    )
    .eq('status', 'approved')
    .or(LISTED_SUPPLIER_PRODUCTS_OR, listedSupplierProductsFilterOptions);

  return applyCategoryFilter(productsQuery, categoryOpts);
}

function applyTextSearchFilter(productsQuery, query) {
  if (!query) return productsQuery;
  const ilikeQuery = `%${query.replace(/\s+/g, '%')}%`;
  return productsQuery.or(
    `name.ilike.${ilikeQuery},brand.ilike.${ilikeQuery},description.ilike.${ilikeQuery}`
  );
}

function applyTokenSearchFilter(productsQuery, query) {
  const patterns = buildTokenIlikePatterns(query);
  if (!patterns.length) return productsQuery;

  const parts = [];
  for (const pattern of patterns) {
    const escaped = pattern.replace(/,/g, ' ');
    parts.push(`name.ilike.${escaped}`, `brand.ilike.${escaped}`);
  }
  return productsQuery.or(parts.slice(0, 14).join(','));
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
  const legacyCategory = Boolean(legacyManualDiscoveryCategoryFilter);
  const normalizedCategoryLegacy = String(category || '').trim().toLowerCase();
  const trimmedCategoryVoice = String(category || '').trim();

  const categoryOpts = {
    legacyCategory,
    normalizedCategoryLegacy,
    trimmedCategoryVoice
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

  const suggestions = (rawProducts || []).map((p) => {
    const supplierCount =
      Array.isArray(p?.supplier_products) && p.supplier_products[0] && Number.isFinite(p.supplier_products[0].count)
        ? p.supplier_products[0].count
        : null;
    const categoryKey = String(p?.category || '').trim().toLowerCase();
    const affinityScore = categoryAffinity.get(categoryKey) || 0;
    const recommendationScore = Number(affinityScore.toFixed(3));
    return {
      ...p,
      supplierCount,
      recommendationScore
    };
  });

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

  const paginatedSuggestions = suggestions.slice(offset, offset + safeLimit);

  return {
    suggestions: paginatedSuggestions,
    total: Number.isFinite(count) ? count : suggestions.length,
    limit: safeLimit,
    offset,
    recommendationMode: 'personalized-order-affinity'
  };
}
