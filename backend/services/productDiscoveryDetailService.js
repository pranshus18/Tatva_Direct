import { enrichProductsWithOfferImages, mergeProductImageLists } from './productImageService.js';
import {
  aggregateEligibleDiscoveryOffers,
  reconcileDiscoveryProductFields
} from './catalogOfferSnapshotService.js';
import {
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  supplierOfferTsinFields
} from '../controllers/supplier/shared/productHelpers.js';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { normalizeTextField } from './productIdentityService.js';
import {
  getPublishedCatalogDescription,
  getSupplierSubmittedDescription,
  resolveBuyerFacingProductDescription
} from '../utils/supplierProductDescriptions.js';

const VARIANT_OPTION_SKIP_KEYS = new Set([
  'brandmodel',
  'brand',
  'description',
  'images',
  'hsncode',
  'hsn_code',
  'lsa',
  'gtin',
  'barcode',
  'mpn',
  'catalogname',
  'asin',
  'variantasin',
  'variantkey',
  'snapshot',
  'identity',
  'catalogkey',
  'matchsignals',
  'asinlikeid',
  'variantasinlikeid'
]);

function detectDiscoveryBrand(product = {}) {
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
}

function toReadableOptionLabel(rawKey) {
  return String(rawKey || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatOptionValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function parseSpecificationsObject(specifications) {
  if (!specifications) return {};
  if (typeof specifications === 'object' && !Array.isArray(specifications)) {
    return specifications.snapshot && typeof specifications.snapshot === 'object'
      ? specifications.snapshot
      : specifications;
  }
  if (typeof specifications === 'string') {
    try {
      const parsed = JSON.parse(specifications);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function collectVariantAttributeMap(variant) {
  const specs = parseSpecificationsObject(variant?.specifications);
  const canonical =
    variant?.canonicalAttributes && typeof variant.canonicalAttributes === 'object'
      ? variant.canonicalAttributes
      : {};
  return { ...specs, ...canonical };
}

function attributeMapKey(rawKey) {
  return normalizeTextField(rawKey).replace(/\s+/g, '_');
}

export function buildVariantOptions(variants = []) {
  const valueSets = new Map();

  for (const variant of variants) {
    const attrs = collectVariantAttributeMap(variant);
    for (const [key, rawValue] of Object.entries(attrs)) {
      const normalizedKey = attributeMapKey(key);
      if (!normalizedKey || VARIANT_OPTION_SKIP_KEYS.has(normalizedKey)) continue;
      const displayValue = formatOptionValue(rawValue);
      if (!displayValue) continue;
      if (!valueSets.has(normalizedKey)) valueSets.set(normalizedKey, new Map());
      const bucket = valueSets.get(normalizedKey);
      if (!bucket.has(displayValue)) {
        bucket.set(displayValue, { key: normalizedKey, label: toReadableOptionLabel(key), value: displayValue });
      }
    }
  }

  return [...valueSets.entries()]
    .filter(([, bucket]) => bucket.size > 1)
    .map(([key, bucket]) => ({
      key,
      label: bucket.values().next().value?.label || toReadableOptionLabel(key),
      values: [...bucket.values()].map((entry) => entry.value).sort((a, b) => a.localeCompare(b))
    }));
}

function mergeOfferSpecifications(productSpecs, offer) {
  const base = parseSpecificationsObject(productSpecs);
  const attrs = offer?.attributes && typeof offer.attributes === 'object' ? offer.attributes : {};
  const fromAttrs =
    parseSpecificationsObject(attrs.specifications) ||
    parseSpecificationsObject(attrs.specs) ||
    {};
  const direct = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (
      [
        'description',
        'name',
        'images',
        'brandModel',
        'lsa',
        'hsnCode',
        'hsn_code',
        'specifications',
        'specs',
        'listingName',
        'supplierDescription'
      ].includes(key)
    ) {
      continue;
    }
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      direct[key] = value;
    }
  }
  // Catalog/admin product specs win over stale offer attribute copies for the same keys.
  // Offer-only keys that are not on the catalog product are still preserved.
  return { ...fromAttrs, ...direct, ...base };
}

function extractIdentityFields(product, specs = {}, offer = null) {
  const attrs = offer?.attributes && typeof offer.attributes === 'object' ? offer.attributes : {};
  return {
    gtin:
      String(product?.gtin || specs?.gtin || specs?.GTIN || attrs?.gtin || '').trim() || null,
    barcode:
      String(product?.barcode || specs?.barcode || specs?.Barcode || attrs?.barcode || '').trim() || null,
    mpn: String(product?.mpn || specs?.mpn || specs?.MPN || attrs?.mpn || '').trim() || null,
    hsnCode:
      String(specs?.hsnCode || specs?.hsn_code || attrs?.hsnCode || attrs?.hsn_code || '').trim() || null,
    lsa: String(specs?.lsa || attrs?.lsa || '').trim() || null,
    brandModel:
      String(
        specs?.brandModel || specs?.brand || product?.brand || attrs?.brandModel || ''
      ).trim() || null
  };
}

function mergeVariantImages(product, offers = []) {
  const lists = [product?.images];
  for (const offer of offers) {
    const attrs = offer?.attributes || {};
    lists.push(attrs?.images);
  }
  return mergeProductImageLists(...lists);
}

async function buildVariantRecord({
  product,
  reconciled,
  offer,
  offers,
  variantMeta,
  variantKey,
  enrichSpecifications
}) {
  const mergedSpecs = mergeOfferSpecifications(product.specifications, offer);
  const tsin = supplierOfferTsinFields(product, offer || {});
  const identity = extractIdentityFields(product, mergedSpecs, offer);
  const attrs = offer?.attributes || {};
  const supplierDescription = getSupplierSubmittedDescription(attrs);
  const publishedDescription = getPublishedCatalogDescription(product);
  const displayDescription = resolveBuyerFacingProductDescription({
    product,
    offerAttributes: attrs
  });
  const stock =
    offer != null
      ? parseSupplierStockQuantity(offer?.stock) ?? 0
      : reconciled.stock;
  const price =
    offer != null
      ? Number.parseFloat(String(offer?.price ?? ''))
      : Number(reconciled.price);
  const resolvedPrice = Number.isFinite(price) && price >= 0 ? price : reconciled.price;

  return {
    productId: product.id,
    name: product.name,
    description: displayDescription || null,
    supplierDescription: supplierDescription || null,
    publishedDescription: publishedDescription || null,
    variantKey: variantKey === 'default' ? null : variantKey || offer?.variant_key || variantMeta?.variant_key || null,
    variantAsin: tsin.variantAsin,
    variantName: variantMeta?.variant_name || product.name,
    asin: tsin.asin,
    specifications: mergedSpecs,
    canonicalAttributes: variantMeta?.canonical_attributes || {},
    images: mergeVariantImages(product, offers || (offer ? [offer] : [])),
    price: resolvedPrice,
    stock,
    unit: product.unit || 'nos',
    min_order_quantity: offer?.min_order_quantity ?? reconciled.min_order_quantity,
    location: String(offer?.location || reconciled.location || '').trim() || null,
    supplierCount: offer ? 1 : reconciled.supplierCount,
    canAddToCart: stock > 0 && (offer ? true : Number(reconciled.supplierCount || 0) > 0),
    average_rating: product.average_rating,
    total_reviews: product.total_reviews,
    tags: product.tags || [],
    gtin: identity.gtin,
    barcode: identity.barcode,
    mpn: identity.mpn,
    hsnCode: identity.hsnCode,
    lsa: identity.lsa,
    brandModel: identity.brandModel
  };
}

function aggregateOffersByVariantKey(offers = []) {
  const byKey = new Map();
  for (const row of offers) {
    const variantKey = String(row?.variant_key || 'default').trim() || 'default';
    const existing = byKey.get(variantKey);
    const stock = parseSupplierStockQuantity(row?.stock) ?? 0;
    const price = Number.parseFloat(String(row?.price ?? ''));
    const candidate = { ...row, _stock: stock, _price: Number.isFinite(price) ? price : 0 };
    if (!existing || candidate._stock > existing._stock) {
      byKey.set(variantKey, candidate);
    } else if (candidate._stock === existing._stock && candidate._price > 0 && existing._price <= 0) {
      byKey.set(variantKey, candidate);
    }
  }
  return byKey;
}

export async function enrichDiscoverySuggestionsWithVariantCounts(supabase, suggestions = []) {
  const rows = Array.isArray(suggestions) ? suggestions : [];
  if (!rows.length) return rows;

  const familyIds = [...new Set(rows.map((p) => p?.family_id).filter(Boolean))];
  const productIds = [...new Set(rows.map((p) => p?.id).filter(Boolean))];

  const countByFamily = new Map();
  if (familyIds.length) {
    const { data: familyProducts } = await supabase
      .from('products')
      .select('id, family_id')
      .in('family_id', familyIds)
      .eq('status', 'approved')
      .or('is_active.eq.true,is_active.is.null');
    for (const row of familyProducts || []) {
      if (!row?.family_id) continue;
      countByFamily.set(row.family_id, (countByFamily.get(row.family_id) || 0) + 1);
    }
  }

  const variantKeysByProduct = new Map();
  if (productIds.length) {
    const { data: offerRows } = await supabase
      .from('supplier_products')
      .select('product_id, variant_key, status, is_active')
      .in('product_id', productIds)
      .eq('status', 'approved')
      .eq('is_active', true);
    for (const row of offerRows || []) {
      const productId = row?.product_id;
      if (!productId) continue;
      const variantKey = String(row?.variant_key || '').trim();
      if (!variantKey) continue;
      if (!variantKeysByProduct.has(productId)) variantKeysByProduct.set(productId, new Set());
      variantKeysByProduct.get(productId).add(variantKey);
    }
  }

  return rows.map((product) => {
    const familyCount = product?.family_id ? countByFamily.get(product.family_id) || 1 : 1;
    const distinctOfferVariants = variantKeysByProduct.get(product?.id)?.size || 0;
    const variantCount = Math.max(familyCount, distinctOfferVariants, 1);
    return {
      ...product,
      variantCount,
      hasVariants: variantCount > 1
    };
  });
}

export const DISCOVERY_DETAIL_AUDIENCES = {
  SERVICE_PROVIDER: 'service_provider',
  SUPPLIER_UPSTREAM: 'supplier_upstream'
};

/**
 * Service providers may only buy from the brand's terminal (retailer-facing) tier, so their
 * discovery view keeps offers filtered to that tier. Suppliers sourcing upstream buy from the
 * tier above them instead, and must still see their own catalog product before any upstream
 * seller has listed it.
 */
export function resolveDiscoveryAudienceRules(audience) {
  const normalized = String(audience || '').trim().toLowerCase();
  const supplierUpstream =
    normalized === DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM || normalized === 'supplier';
  return {
    audience: supplierUpstream
      ? DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM
      : DISCOVERY_DETAIL_AUDIENCES.SERVICE_PROVIDER,
    enforceTerminalRole: !supplierUpstream,
    requireEligibleOffers: !supplierUpstream,
    // Suppliers open details for listings they already own, including ones still awaiting
    // catalog approval; buyer-facing discovery stays limited to approved products.
    allowUnapprovedOwnListing: supplierUpstream
  };
}

async function supplierOwnsCatalogProduct(supabase, productId, supplierId) {
  const normalizedSupplierId = String(supplierId || '').trim();
  if (!normalizedSupplierId) return false;
  const { data, error } = await supabase
    .from('supplier_products')
    .select('id')
    .eq('product_id', productId)
    .eq('supplier_id', normalizedSupplierId)
    .limit(1);
  if (error) throw error;
  if (Array.isArray(data)) return data.length > 0;
  return Boolean(data);
}

export async function getProductDiscoveryDetail(
  supabase,
  {
    productId,
    enrichSpecifications = null,
    audience = DISCOVERY_DETAIL_AUDIENCES.SERVICE_PROVIDER,
    viewerSupplierId = null
  }
) {
  const audienceRules = resolveDiscoveryAudienceRules(audience);
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) {
    return { ok: false, status: 404, message: 'Product not found' };
  }

  const { data: baseProduct, error: productError } = await supabase
    .from('products')
    .select(
      `
        id,
        name,
        description,
        category,
        unit,
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
        asin,
        family_id,
        variant_id,
        updated_at
      `
    )
    .eq('id', normalizedProductId)
    .maybeSingle();

  if (productError) throw productError;
  if (!baseProduct?.id) {
    return { ok: false, status: 404, message: 'Product not found' };
  }
  if (String(baseProduct.status || '').toLowerCase() !== 'approved') {
    const viewerOwnsListing =
      audienceRules.allowUnapprovedOwnListing &&
      (await supplierOwnsCatalogProduct(supabase, baseProduct.id, viewerSupplierId));
    if (!viewerOwnsListing) {
      return { ok: false, status: 404, message: 'Product not found' };
    }
  }

  let family = null;
  if (baseProduct.family_id) {
    const { data: familyRow } = await supabase
      .from('product_families')
      .select('id, canonical_name, brand, category, normalized_family_key')
      .eq('id', baseProduct.family_id)
      .maybeSingle();
    if (familyRow?.id) {
      family = {
        id: familyRow.id,
        canonicalName: familyRow.canonical_name || baseProduct.name,
        brand: familyRow.brand || baseProduct.brand || null,
        category: familyRow.category || baseProduct.category || null
      };
    }
  }

  let siblingProducts = [baseProduct];
  if (baseProduct.family_id) {
    const { data: familyProducts, error: familyProductsError } = await supabase
      .from('products')
      .select(
        `
          id,
          name,
          description,
          category,
          unit,
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
          asin,
          family_id,
          variant_id,
          updated_at
        `
      )
      .eq('family_id', baseProduct.family_id)
      .eq('status', 'approved')
      .or('is_active.eq.true,is_active.is.null')
      .order('name', { ascending: true });
    if (familyProductsError) throw familyProductsError;
    if (Array.isArray(familyProducts) && familyProducts.length) {
      siblingProducts = familyProducts;
    }
  }

  const siblingIds = [...new Set(siblingProducts.map((p) => p?.id).filter(Boolean))];
  const enrichedProducts = await enrichProductsWithOfferImages(supabase, siblingProducts);
  const productById = new Map(enrichedProducts.map((p) => [p.id, p]));

  const { data: offerRows, error: offersError } = await supabase
    .from('supplier_products')
    .select(
      `
        id,
        product_id,
        price,
        stock,
        min_order_quantity,
        location,
        variant_key,
        variant_asin,
        product_variant_id,
        attributes,
        status,
        is_active,
        supplier:users!supplier_products_supplier_id_fkey(profile)
      `
    )
    .in('product_id', siblingIds)
    .neq('status', 'rejected');
  if (offersError) throw offersError;

  const brandCandidates = enrichedProducts.map((p) => detectDiscoveryBrand(p)).filter(Boolean);
  const terminalRoleByBrandMap = audienceRules.enforceTerminalRole
    ? await loadAdminBrandTerminalRoleMap(supabase, brandCandidates)
    : new Map();
  const offerAggregates = aggregateEligibleDiscoveryOffers({
    offerRows: offerRows || [],
    productById,
    detectDiscoveryBrand,
    terminalRoleByBrandMap,
    supplierMatchesBrandTerminalRoleFn: audienceRules.enforceTerminalRole
      ? supplierMatchesBrandTerminalRole
      : () => true
  });

  const variantMetaByProductId = new Map();
  const variantIds = [...new Set(enrichedProducts.map((p) => p?.variant_id).filter(Boolean))];
  if (variantIds.length) {
    const { data: variantRows } = await supabase
      .from('product_variants')
      .select('id, product_id, variant_name, variant_key, variant_asin, canonical_attributes')
      .in('id', variantIds);
    for (const row of variantRows || []) {
      if (row?.product_id) variantMetaByProductId.set(row.product_id, row);
    }
  }

  const offersByProductId = new Map();
  for (const row of offerRows || []) {
    const pid = row?.product_id;
    if (!pid) continue;
    if (!offersByProductId.has(pid)) offersByProductId.set(pid, []);
    offersByProductId.get(pid).push(row);
  }

  const variantCandidates = [];

  for (const product of enrichedProducts) {
    const reconciled = reconcileDiscoveryProductFields(product, offerAggregates);
    if (audienceRules.requireEligibleOffers && Number(reconciled?.supplierCount || 0) <= 0) continue;

    const productOffers = (offersByProductId.get(product.id) || []).filter(
      (row) => String(row?.status || '').toLowerCase() === 'approved' && row?.is_active === true
    );
    const offersByVariantKey = aggregateOffersByVariantKey(productOffers);
    const variantMeta = variantMetaByProductId.get(product.id) || null;

    if (offersByVariantKey.size <= 1) {
      const offer = offersByVariantKey.values().next().value || null;
      variantCandidates.push(
        await buildVariantRecord({
          product,
          reconciled,
          offer,
          offers: productOffers,
          variantMeta,
          variantKey: offer?.variant_key || variantMeta?.variant_key || null,
          enrichSpecifications
        })
      );
      continue;
    }

    for (const [variantKey, offer] of offersByVariantKey.entries()) {
      variantCandidates.push(
        await buildVariantRecord({
          product,
          reconciled,
          offer,
          offers: [offer],
          variantMeta,
          variantKey,
          enrichSpecifications
        })
      );
    }
  }

  variantCandidates.sort((a, b) => {
    const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''));
    if (nameDiff !== 0) return nameDiff;
    return String(a?.variantKey || '').localeCompare(String(b?.variantKey || ''));
  });

  if (variantCandidates.length === 0) {
    const product = enrichedProducts.find((p) => p.id === baseProduct.id) || baseProduct;
    const reconciled = reconcileDiscoveryProductFields(product, offerAggregates);
    const productOffers = (offersByProductId.get(product.id) || []).filter(
      (row) => String(row?.status || '').toLowerCase() === 'approved' && row?.is_active === true
    );
    variantCandidates.push(
      await buildVariantRecord({
        product,
        reconciled,
        offer: productOffers[0] || null,
        offers: productOffers,
        variantMeta: variantMetaByProductId.get(product.id) || null,
        variantKey: productOffers[0]?.variant_key || null,
        enrichSpecifications
      })
    );
  }

  const variantOptions = buildVariantOptions(variantCandidates);
  const variantCount = Math.max(variantCandidates.length, 1);
  const hasVariants = variantCount > 1;

  const summaryProduct = reconcileDiscoveryProductFields(
    enrichedProducts.find((p) => p.id === baseProduct.id) || baseProduct,
    offerAggregates
  );

  const prices = variantCandidates.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const priceRange =
    prices.length > 1
      ? { min: Math.min(...prices), max: Math.max(...prices) }
      : prices.length === 1
        ? { min: prices[0], max: prices[0] }
        : null;

  const summaryIdentity = extractIdentityFields(
    summaryProduct,
    parseSpecificationsObject(summaryProduct.specifications)
  );

  return {
    ok: true,
    audience: audienceRules.audience,
    product: {
      id: summaryProduct.id,
      // Always use the selected catalog product's name — family canonical names are
      // grouping metadata and must not replace the product the user clicked.
      name: summaryProduct.name,
      description: getPublishedCatalogDescription(summaryProduct) || null,
      publishedDescription: getPublishedCatalogDescription(summaryProduct) || null,
      category: summaryProduct.category,
      brand: family?.brand || summaryProduct.brand || summaryIdentity.brandModel || null,
      unit: summaryProduct.unit,
      average_rating: summaryProduct.average_rating,
      total_reviews: summaryProduct.total_reviews,
      tags: summaryProduct.tags || [],
      asin: summaryProduct.asin || null,
      gtin: summaryIdentity.gtin,
      barcode: summaryIdentity.barcode,
      mpn: summaryIdentity.mpn,
      hsnCode: summaryIdentity.hsnCode,
      lsa: summaryIdentity.lsa,
      brandModel: summaryIdentity.brandModel,
      priceRange,
      supplierCount: summaryProduct.supplierCount,
      canAddToCart: Number(summaryProduct.supplierCount || 0) > 0 && Number(summaryProduct.stock || 0) > 0
    },
    family,
    hasVariants,
    variantCount,
    variantOptions,
    variants: variantCandidates
  };
}
