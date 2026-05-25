export const normalizeIdPart = (value) => (value === null || value === undefined ? '' : String(value).trim());

export const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = normalizeIdPart(value);
    if (normalized) return normalized;
  }
  return '';
};

export const buildProductIdentification = ({ skuNo, modelBrand }) => {
  const parts = [skuNo, modelBrand].map(normalizeIdPart);
  if (parts.every((p) => !p)) return '';
  return parts.join('');
};

export const normalizeBrandKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const parseFiniteNumber = (value) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

export const parseCovThresholdNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const sanitized = raw.replace(/,/g, '');
  const match = sanitized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseBcovNotesSafe = (rawNotes) => {
  const raw = String(rawNotes || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { buyerBcov: raw };
  }
};

export const resolveBcovPriceForBuyerMetrics = ({ levels = [], supplierCov = 0, platformCov = 0, brandCov = 0 }) => {
  const matchedLevels = (levels || []).filter((row) => {
    const notes = parseBcovNotesSafe(row?.notes);
    const supplierCovThreshold = parseCovThresholdNumber(notes?.buyerBcov);
    const brandCovThreshold = parseFiniteNumber(row.min_purchase_qty);
    const platformCovThreshold =
      row.max_purchase_qty === null || row.max_purchase_qty === undefined
        ? null
        : parseFiniteNumber(row.max_purchase_qty);
    const supplierSatisfied = supplierCovThreshold !== null && supplierCov >= supplierCovThreshold;
    const brandSatisfied = brandCovThreshold !== null && brandCov >= brandCovThreshold;
    const platformSatisfied = platformCovThreshold !== null && platformCov >= platformCovThreshold;
    return supplierSatisfied || brandSatisfied || platformSatisfied;
  });
  if (matchedLevels.length === 0) return null;
  const matched = [...matchedLevels]
    .map((row) => ({ row, price: parseFiniteNumber(row.unit_price) }))
    .filter((entry) => entry.price !== null && entry.price >= 0)
    .sort((a, b) => a.price - b.price)[0];
  if (!matched) return null;
  return {
    levelId: matched.row.id,
    price: matched.price
  };
};

export const extractVariantKeyForBcov = ({ supplierProduct, item }) => {
  return String(
    supplierProduct?.variant_key ||
    item?.variantKey ||
    supplierProduct?.variant_asin ||
    item?.variantAsin ||
    supplierProduct?.id ||
    item?.supplierProductId ||
    ''
  ).trim();
};

export const extractBrandForBcov = ({ supplierProduct, item }) => {
  const spAttrs = supplierProduct?.attributes || {};
  const product = supplierProduct?.product || {};
  const specs = product?.specifications || {};
  const itemSpecs = item?.specifications || {};
  const rawBrand =
    spAttrs.brandModel ||
    spAttrs.brand ||
    product.brand ||
    product.name ||
    specs.brand ||
    specs.brandModel ||
    item?.brand ||
    item?.brandName ||
    item?.brandModel ||
    item?.normalizedName ||
    item?.rawName ||
    itemSpecs.brand ||
    itemSpecs.brandModel ||
    '';
  return normalizeBrandKey(rawBrand);
};

export const extractBcovScopeKeys = ({ supplierProduct, item }) => {
  const variantKey = String(supplierProduct?.variant_key || item?.variantKey || '').trim();
  const variantAsin = String(supplierProduct?.variant_asin || item?.variantAsin || '').trim();
  return [...new Set([variantKey, variantAsin].filter(Boolean))];
};

export const buildBcovResolver = (supabaseClient) => {
  const cache = new Map();
  const buyerMetricsCache = new Map();
  const buyerBrandCovCache = new Map();

  const loadPaidOrders = async (buyerId) => {
    if (!buyerId) return [];
    if (buyerMetricsCache.has(buyerId)) return buyerMetricsCache.get(buyerId);
    const { data, error } = await supabaseClient
      .from('orders')
      .select('id, supplier_id, total_amount')
      .eq('service_provider_id', buyerId)
      .eq('channel', 'b2b_po')
      .eq('payment_status', 'paid');
    if (error) {
      console.error('[BCOV] load buyer paid orders error:', error);
      buyerMetricsCache.set(buyerId, []);
      return [];
    }
    const rows = data || [];
    buyerMetricsCache.set(buyerId, rows);
    return rows;
  };

  const loadBrandCovByBuyer = async (buyerId) => {
    if (!buyerId) return new Map();
    if (buyerBrandCovCache.has(buyerId)) return buyerBrandCovCache.get(buyerId);
    const paidOrders = await loadPaidOrders(buyerId);
    const paidOrderIds = [...new Set(paidOrders.map((row) => row.id).filter(Boolean))];
    if (paidOrderIds.length === 0) {
      const empty = new Map();
      buyerBrandCovCache.set(buyerId, empty);
      return empty;
    }

    const { data: orderItems, error: orderItemsError } = await supabaseClient
      .from('order_items')
      .select('order_id, product_id, total_price')
      .in('order_id', paidOrderIds);
    if (orderItemsError) {
      console.error('[BCOV] load order items for brand COV error:', orderItemsError);
      const empty = new Map();
      buyerBrandCovCache.set(buyerId, empty);
      return empty;
    }

    const productIds = [...new Set((orderItems || []).map((row) => row.product_id).filter(Boolean))];
    const productsById = new Map();
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabaseClient
        .from('products')
        .select('id, brand, specifications')
        .in('id', productIds);
      if (productsError) {
        console.error('[BCOV] load products for brand COV error:', productsError);
      } else {
        for (const row of products || []) productsById.set(row.id, row);
      }
    }

    const totals = new Map();
    for (const item of orderItems || []) {
      const product = productsById.get(item.product_id) || {};
      const specs = product?.specifications || {};
      const brandKey = normalizeBrandKey(product?.brand || specs?.brand || specs?.brandModel || specs?.modelBrand || '');
      if (!brandKey) continue;
      const amount = parseFiniteNumber(item.total_price) || 0;
      if (amount <= 0) continue;
      totals.set(brandKey, (totals.get(brandKey) || 0) + amount);
    }

    buyerBrandCovCache.set(buyerId, totals);
    return totals;
  };

  return async ({ buyerId, supplierId, variantKey, brandKey, scopeKeys = [] }) => {
    if (!buyerId || !supplierId) return null;

    const lookupKeys = [
      ...(variantKey ? [variantKey] : []),
      ...((Array.isArray(scopeKeys) ? scopeKeys : []).filter(Boolean))
    ];
    const uniqueKeys = [...new Set(lookupKeys.filter(Boolean))];
    if (uniqueKeys.length === 0) return null;

    const paidOrders = await loadPaidOrders(buyerId);
    const platformCov = paidOrders.reduce((sum, row) => sum + (parseFiniteNumber(row.total_amount) || 0), 0);
    const supplierCov = paidOrders
      .filter((row) => row.supplier_id === supplierId)
      .reduce((sum, row) => sum + (parseFiniteNumber(row.total_amount) || 0), 0);
    const brandCovByBrand = await loadBrandCovByBuyer(buyerId);
    const fallbackBrandKey = normalizeBrandKey(brandKey || '');
    const brandCov = parseFiniteNumber(brandCovByBrand.get(fallbackBrandKey)) || 0;

    for (const key of uniqueKeys) {
      const cacheKey = `${supplierId}::${key}`;
      let levels = cache.get(cacheKey);
      if (!levels) {
        const { data, error } = await supabaseClient
          .from('supplier_bcov_levels')
          .select('id, min_purchase_qty, max_purchase_qty, unit_price, notes')
          .eq('supplier_id', supplierId)
          .eq('variant_key', key)
          .order('min_purchase_qty', { ascending: false });
        if (error) {
          console.error('[BCOV] load levels error:', error);
          cache.set(cacheKey, []);
          continue;
        }
        levels = data || [];
        cache.set(cacheKey, levels);
      }
      if (!levels || levels.length === 0) continue;

      const resolved = resolveBcovPriceForBuyerMetrics({
        levels,
        supplierCov,
        platformCov,
        brandCov
      });
      if (resolved) return resolved;
    }
    return null;
  };
};
