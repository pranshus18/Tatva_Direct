import { enrichProductsWithOfferImages, resolveSupplierOfferDisplayImages } from './productImageService.js';
import {
  aggregateEligibleDiscoveryOffers,
  filterListedOffersForDiscoveryAudience,
  isListedSupplierOffer,
  parseOfferPrice,
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
import {
  mergeOfferSpecifications,
  parseCanonicalAttributes
} from './supplierCatalogHelpersService.js';
import { resolveSupplierOfferDisplayName } from './supplierProductWriteService.js';

const VARIANT_OPTION_SKIP_KEYS = new Set([
  'brandmodel',
  'brand',
  'category',
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

function optionValueDedupKey(displayValue) {
  return String(displayValue || '').trim().toLowerCase();
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
      const dedupKey = optionValueDedupKey(displayValue);
      if (!bucket.has(dedupKey)) {
        bucket.set(dedupKey, {
          key: normalizedKey,
          label: toReadableOptionLabel(key),
          value: displayValue
        });
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

export {
  mergeOfferSpecifications,
  resolveVariantCatalogProduct,
  resolveVariantDisplayImages,
  indexListedOffersByCatalogProduct
};

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

/** Per-variant gallery: only this offer's photos, not every variant merged on the catalog row. */
function resolveVariantDisplayImages(product, offer) {
  const offerImages = offer?.attributes?.images;
  return resolveSupplierOfferDisplayImages(offerImages, product?.images);
}

function resolveVariantOfferBucketKey(row = {}) {
  const variantAsin = String(row?.variant_asin || '').trim();
  if (variantAsin) return `va:${variantAsin}`;
  const variantKey = String(row?.variant_key || '').trim();
  if (variantKey) return `vk:${variantKey}`;
  const offerId = String(row?.id || '').trim();
  if (offerId) return `offer:${offerId}`;
  return 'default';
}

function resolveVariantDisplayUnit(product, offer, mergedSpecs = {}) {
  const attrs = offer?.attributes && typeof offer.attributes === 'object' ? offer.attributes : {};
  const candidates = [
    attrs.unit,
    mergedSpecs?.CAPACITY,
    mergedSpecs?.capacity,
    mergedSpecs?.packSize,
    mergedSpecs?.pack_size,
    product?.unit
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) return normalized;
  }
  return 'nos';
}

function resolveVariantOfferPrice(offer, reconciled) {
  if (offer) {
    return parseOfferPrice(offer.price ?? offer._price);
  }
  return parseOfferPrice(reconciled?.price);
}

/** Map listed offers onto the catalog product each variant row represents (supports family siblings). */
function indexListedOffersByCatalogProduct({
  enrichedProducts,
  offersByProductId,
  productById,
  variantMetaByProductId,
  variantMetaByKey
}) {
  const byCatalogProductId = new Map();

  for (const anchorProduct of enrichedProducts) {
    for (const offer of offersByProductId.get(anchorProduct.id) || []) {
      if (!isListedSupplierOffer(offer)) continue;
      const variantMeta = resolveVariantMeta(
        variantMetaByProductId,
        variantMetaByKey,
        anchorProduct.id,
        offer
      );
      const catalogProduct = resolveVariantCatalogProduct(productById, anchorProduct, variantMeta);
      const catalogId = catalogProduct?.id;
      if (!catalogId) continue;
      if (!byCatalogProductId.has(catalogId)) byCatalogProductId.set(catalogId, []);
      byCatalogProductId.get(catalogId).push({
        offer,
        anchorProduct,
        variantMeta,
        catalogProduct
      });
    }
  }

  return byCatalogProductId;
}

function resolveVariantMeta(variantMetaByProductId, variantMetaByKey, productId, offer) {
  // Asin-first matches vendor ranking / resolveOfferCatalogProductId so list and detail agree.
  const variantAsin = String(offer?.variant_asin || '').trim();
  if (variantAsin && variantMetaByKey.has(`asin:${variantAsin}`)) {
    return variantMetaByKey.get(`asin:${variantAsin}`);
  }
  const variantKey = String(offer?.variant_key || '').trim();
  if (variantKey && variantMetaByKey.has(variantKey)) {
    return variantMetaByKey.get(variantKey);
  }
  return variantMetaByProductId.get(productId) || null;
}

/** Prefer the catalog product linked to product_variants when family siblings diverge. */
function resolveVariantCatalogProduct(productById, fallbackProduct, variantMeta) {
  const metaProductId = String(variantMeta?.product_id || '').trim();
  if (metaProductId && productById.has(metaProductId)) {
    return productById.get(metaProductId);
  }
  return fallbackProduct;
}

function variantCandidateDedupKey(record = {}) {
  return [
    record.productId || '',
    record.variantKey || '',
    record.variantAsin || '',
    record.supplierProductId || ''
  ].join('::');
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
  const mergedSpecs = mergeOfferSpecifications(product.specifications, offer, variantMeta);
  const tsin = supplierOfferTsinFields(product, offer || {});
  const identity = extractIdentityFields(product, mergedSpecs, offer);
  const attrs = offer?.attributes || {};
  const supplierDescription = getSupplierSubmittedDescription(attrs);
  const publishedDescription = resolveBuyerFacingProductDescription({
    product,
    offerAttributes: attrs
  });
  const displayDescription = publishedDescription;
  const displayName = resolveSupplierOfferDisplayName({
    attributes: attrs,
    catalogName: product.name
  });
  const canonicalAttributes = parseCanonicalAttributes(variantMeta?.canonical_attributes);
  const stock =
    offer != null
      ? parseSupplierStockQuantity(offer?.stock) ?? 0
      : reconciled.stock;
  const resolvedPrice = resolveVariantOfferPrice(offer, reconciled);
  const resolvedUnit = resolveVariantDisplayUnit(product, offer, mergedSpecs);

  return {
    productId: product.id,
    name: displayName,
    description: displayDescription || null,
    supplierDescription: supplierDescription || null,
    publishedDescription: publishedDescription || null,
    variantKey: variantKey === 'default' ? null : variantKey || offer?.variant_key || variantMeta?.variant_key || null,
    variantAsin: tsin.variantAsin,
    variantName: variantMeta?.variant_name || displayName,
    asin: tsin.asin,
    specifications: mergedSpecs,
    canonicalAttributes,
    images: resolveVariantDisplayImages(product, offer),
    price: resolvedPrice,
    stock,
    unit: resolvedUnit,
    supplierProductId: offer?.id || null,
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

function pickPreferredVariantOffer(existing, candidate, preferSupplierId = '') {
  const preferredId = String(preferSupplierId || '').trim();
  if (preferredId) {
    const candidateIsPreferred = String(candidate?.supplier_id || '').trim() === preferredId;
    const existingIsPreferred = String(existing?.supplier_id || '').trim() === preferredId;
    if (candidateIsPreferred && !existingIsPreferred) return candidate;
    if (existingIsPreferred && !candidateIsPreferred) return existing;
  }

  if (candidate._stock > existing._stock) return candidate;
  if (candidate._stock < existing._stock) return existing;
  if (candidate._price > 0 && existing._price <= 0) return candidate;
  if (candidate._price > 0 && existing._price > 0 && candidate._price < existing._price) {
    return candidate;
  }
  return existing;
}

export function aggregateOffersByVariantIdentity(offers = [], { preferSupplierId = null } = {}) {
  const byKey = new Map();
  for (const row of offers) {
    const bucketKey = resolveVariantOfferBucketKey(row);
    const existing = byKey.get(bucketKey);
    const stock = parseSupplierStockQuantity(row?.stock) ?? 0;
    const price = parseOfferPrice(row?.price);
    const candidate = { ...row, _stock: stock, _price: price };
    if (!existing) {
      byKey.set(bucketKey, candidate);
      continue;
    }
    byKey.set(bucketKey, pickPreferredVariantOffer(existing, candidate, preferSupplierId));
  }
  return byKey;
}

function buildViewerListingSnapshot(row, productById) {
  const productId = String(row?.product_id || '').trim();
  const product = productById.get(productId) || null;
  const attrs = row?.attributes && typeof row.attributes === 'object' ? row.attributes : {};
  const mergedSpecs = mergeOfferSpecifications(product?.specifications, row, null);
  return {
    id: row?.id || null,
    productId: productId || null,
    variantKey: String(row?.variant_key || '').trim() || null,
    variantAsin: String(row?.variant_asin || '').trim() || null,
    price: parseOfferPrice(row?.price),
    stock: parseSupplierStockQuantity(row?.stock) ?? 0,
    unit: resolveVariantDisplayUnit(product || {}, row, mergedSpecs),
    min_order_quantity: row?.min_order_quantity ?? product?.min_order_quantity ?? null,
    location: String(row?.location || product?.location || '').trim() || null,
    name: resolveSupplierOfferDisplayName({
      attributes: attrs,
      catalogName: product?.name || ''
    })
  };
}

export function resolveViewerListingForVariant(viewerListings = [], variant = null, mineSupplierProductId = '') {
  const listings = Array.isArray(viewerListings) ? viewerListings : [];
  const mineId = String(mineSupplierProductId || '').trim();

  const listingMatchesVariant = (listing) => {
    if (!listing || !variant) return false;
    const variantAsin = String(variant?.variantAsin || '').trim();
    const variantKey = String(variant?.variantKey || '').trim();
    const listingAsin = String(listing?.variantAsin || '').trim();
    const listingKey = String(listing?.variantKey || '').trim();
    if (variantAsin && listingAsin && listingAsin === variantAsin) return true;
    if (variantKey && listingKey && listingKey === variantKey) return true;
    return false;
  };

  // Prefer identity match for the active variant so price/stock track the selected chip.
  if (variant) {
    const byVariant = listings.find((listing) => listingMatchesVariant(listing));
    if (byVariant) return byVariant;
  }

  if (mineId) {
    const byMine = listings.find((listing) => String(listing?.id || '') === mineId);
    if (byMine) return byMine;
  }

  if (!variant) return null;

  const variantAsin = String(variant?.variantAsin || '').trim();
  const variantKey = String(variant?.variantKey || '').trim();
  const productId = String(variant?.productId || '').trim();
  if (variantAsin || variantKey || !productId) return null;

  const sameProduct = listings.filter(
    (listing) => String(listing?.productId || '').trim() === productId
  );
  return sameProduct.length === 1 ? sameProduct[0] : null;
}

export async function enrichDiscoverySuggestionsWithVariantCounts(
  supabase,
  suggestions = [],
  {
    enforceTerminalRole = true,
    detectDiscoveryBrand: detectBrand = detectDiscoveryBrand,
    supplierMatchesBrandTerminalRoleFn = supplierMatchesBrandTerminalRole
  } = {}
) {
  const rows = Array.isArray(suggestions) ? suggestions : [];
  if (!rows.length) return rows;

  const familyIds = [...new Set(rows.map((p) => p?.family_id).filter(Boolean))];
  const productIds = [...new Set(rows.map((p) => p?.id).filter(Boolean))];

  const familySiblingIdsByFamily = new Map();
  const allFamilyProductIds = new Set();
  if (familyIds.length) {
    const { data: familyProducts } = await supabase
      .from('products')
      .select('id, family_id, brand, specifications')
      .in('family_id', familyIds)
      .eq('status', 'approved')
      .or('is_active.eq.true,is_active.is.null');
    for (const row of familyProducts || []) {
      if (!row?.family_id || !row?.id) continue;
      if (!familySiblingIdsByFamily.has(row.family_id)) {
        familySiblingIdsByFamily.set(row.family_id, []);
      }
      familySiblingIdsByFamily.get(row.family_id).push(row);
      allFamilyProductIds.add(row.id);
    }
  }

  const offerProductIds = [...new Set([...productIds, ...allFamilyProductIds])];
  const productById = new Map();
  for (const suggestion of rows) {
    if (suggestion?.id) productById.set(suggestion.id, suggestion);
  }
  for (const siblings of familySiblingIdsByFamily.values()) {
    for (const sibling of siblings) {
      if (sibling?.id && !productById.has(sibling.id)) {
        productById.set(sibling.id, sibling);
      }
    }
  }

  const brandCandidates = [...productById.values()].map((p) => detectBrand(p)).filter(Boolean);
  const terminalRoleByBrandMap = enforceTerminalRole
    ? await loadAdminBrandTerminalRoleMap(supabase, brandCandidates)
    : new Map();

  const variantKeysByProduct = new Map();
  const productsWithEligibleOffers = new Set();
  if (offerProductIds.length) {
    const { data: offerRows } = await supabase
      .from('supplier_products')
      .select(
        'product_id, variant_key, status, is_active, supplier:users!supplier_products_supplier_id_fkey(profile)'
      )
      .in('product_id', offerProductIds)
      .eq('status', 'approved')
      .eq('is_active', true);

    const eligibleOffers = filterListedOffersForDiscoveryAudience({
      offerRows: offerRows || [],
      productById,
      detectDiscoveryBrand: detectBrand,
      terminalRoleByBrandMap,
      supplierMatchesBrandTerminalRoleFn,
      enforceTerminalRole
    });

    for (const row of eligibleOffers) {
      const productId = row?.product_id;
      if (!productId) continue;
      productsWithEligibleOffers.add(productId);
      const variantKey = String(row?.variant_key || '').trim();
      if (!variantKey) continue;
      if (!variantKeysByProduct.has(productId)) variantKeysByProduct.set(productId, new Set());
      variantKeysByProduct.get(productId).add(variantKey);
    }
  }

  return rows.map((product) => {
    const familySiblings = product?.family_id
      ? familySiblingIdsByFamily.get(product.family_id) || []
      : [];
    const eligibleFamilyCount = familySiblings.filter((sibling) =>
      productsWithEligibleOffers.has(sibling.id)
    ).length;
    const familyCount = Math.max(
      eligibleFamilyCount,
      productsWithEligibleOffers.has(product?.id) ? 1 : 0
    );
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
  const matchTerminalRole = audienceRules.enforceTerminalRole
    ? supplierMatchesBrandTerminalRole
    : () => true;
  // Buyer discovery variants must use the same terminal-tier offer set as stock/price —
  // otherwise upstream sellers appear as purchasable "variants" under the product.
  const discoveryOfferRows = filterListedOffersForDiscoveryAudience({
    offerRows: offerRows || [],
    productById,
    detectDiscoveryBrand,
    terminalRoleByBrandMap,
    supplierMatchesBrandTerminalRoleFn: matchTerminalRole,
    enforceTerminalRole: audienceRules.enforceTerminalRole
  });
  const offerAggregates = aggregateEligibleDiscoveryOffers({
    offerRows: discoveryOfferRows,
    productById,
    detectDiscoveryBrand,
    terminalRoleByBrandMap,
    supplierMatchesBrandTerminalRoleFn: matchTerminalRole
  });

  const variantMetaByProductId = new Map();
  const variantMetaByKey = new Map();
  const variantIds = [...new Set(enrichedProducts.map((p) => p?.variant_id).filter(Boolean))];
  if (variantIds.length) {
    const { data: variantRows } = await supabase
      .from('product_variants')
      .select('id, product_id, variant_name, variant_key, variant_asin, canonical_attributes')
      .in('id', variantIds);
    for (const row of variantRows || []) {
      if (row?.product_id) variantMetaByProductId.set(row.product_id, row);
      if (row?.variant_key) variantMetaByKey.set(String(row.variant_key), row);
      if (row?.variant_asin) variantMetaByKey.set(`asin:${String(row.variant_asin)}`, row);
    }
  }
  if (baseProduct.family_id) {
    const { data: familyVariantRows } = await supabase
      .from('product_variants')
      .select('id, product_id, variant_name, variant_key, variant_asin, canonical_attributes')
      .eq('family_id', baseProduct.family_id);
    for (const row of familyVariantRows || []) {
      if (row?.product_id && !variantMetaByProductId.has(row.product_id)) {
        variantMetaByProductId.set(row.product_id, row);
      }
      if (row?.variant_key) variantMetaByKey.set(String(row.variant_key), row);
      if (row?.variant_asin) variantMetaByKey.set(`asin:${String(row.variant_asin)}`, row);
    }
  }

  const offersByProductId = new Map();
  for (const row of discoveryOfferRows) {
    const pid = row?.product_id;
    if (!pid) continue;
    if (!offersByProductId.has(pid)) offersByProductId.set(pid, []);
    offersByProductId.get(pid).push(row);
  }

  let viewerListings = [];
  const normalizedViewerSupplierId = String(viewerSupplierId || '').trim();
  if (
    audienceRules.audience === DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM &&
    normalizedViewerSupplierId
  ) {
    const { data: viewerListingRows, error: viewerListingError } = await supabase
      .from('supplier_products')
      .select(
        `
          id,
          product_id,
          supplier_id,
          price,
          stock,
          min_order_quantity,
          location,
          variant_key,
          variant_asin,
          attributes,
          status,
          is_active
        `
      )
      .in('product_id', siblingIds)
      .eq('supplier_id', normalizedViewerSupplierId)
      .neq('status', 'rejected');
    if (viewerListingError) throw viewerListingError;
    viewerListings = (viewerListingRows || []).map((row) =>
      buildViewerListingSnapshot(row, productById)
    );
  }

  const variantCandidates = [];
  const seenVariantKeys = new Set();
  const offersByCatalogProductId = indexListedOffersByCatalogProduct({
    enrichedProducts,
    offersByProductId,
    productById,
    variantMetaByProductId,
    variantMetaByKey
  });

  for (const product of enrichedProducts) {
    const reconciled = reconcileDiscoveryProductFields(product, offerAggregates);
    const attachedEntries = offersByCatalogProductId.get(product.id) || [];
    // Service providers: skip siblings/variants with no terminal-tier offers.
    // Do not keep upstream-only attached offers as an escape hatch.
    if (audienceRules.requireEligibleOffers && Number(reconciled?.supplierCount || 0) <= 0) {
      continue;
    }

    const offersByIdentity = aggregateOffersByVariantIdentity(
      attachedEntries.map((entry) => entry.offer),
      { preferSupplierId: normalizedViewerSupplierId || null }
    );
    const entryByOfferId = new Map(
      attachedEntries
        .filter((entry) => entry?.offer?.id)
        .map((entry) => [String(entry.offer.id), entry])
    );

    if (offersByIdentity.size === 0) {
      // Upstream discovery may still show catalog shells with no offers yet.
      if (audienceRules.requireEligibleOffers) continue;
      const variantMeta = resolveVariantMeta(variantMetaByProductId, variantMetaByKey, product.id, null);
      const record = await buildVariantRecord({
        product,
        reconciled,
        offer: null,
        offers: [],
        variantMeta,
        variantKey: variantMeta?.variant_key || null,
        enrichSpecifications
      });
      const dedupKey = variantCandidateDedupKey(record);
      if (!seenVariantKeys.has(dedupKey)) {
        seenVariantKeys.add(dedupKey);
        variantCandidates.push(record);
      }
      continue;
    }

    for (const [, offer] of offersByIdentity.entries()) {
      const entry =
        entryByOfferId.get(String(offer?.id || '')) ||
        attachedEntries.find(
          (candidate) =>
            resolveVariantOfferBucketKey(candidate.offer) === resolveVariantOfferBucketKey(offer)
        );
      const variantMeta =
        entry?.variantMeta ||
        resolveVariantMeta(variantMetaByProductId, variantMetaByKey, offer?.product_id, offer);
      const catalogProduct =
        entry?.catalogProduct || resolveVariantCatalogProduct(productById, product, variantMeta);
      const catalogReconciled = reconcileDiscoveryProductFields(catalogProduct, offerAggregates);
      const record = await buildVariantRecord({
        product: catalogProduct,
        reconciled: catalogReconciled,
        offer,
        offers: [offer],
        variantMeta,
        variantKey: offer?.variant_key || variantMeta?.variant_key || null,
        enrichSpecifications
      });
      const dedupKey = variantCandidateDedupKey(record);
      if (seenVariantKeys.has(dedupKey)) continue;
      seenVariantKeys.add(dedupKey);
      variantCandidates.push(record);
    }
  }

  if (variantCandidates.length === 0) {
    for (const product of enrichedProducts) {
      const reconciled = reconcileDiscoveryProductFields(product, offerAggregates);
      if (audienceRules.requireEligibleOffers && Number(reconciled?.supplierCount || 0) <= 0) {
        continue;
      }
      const variantMeta = resolveVariantMeta(variantMetaByProductId, variantMetaByKey, product.id, null);
      variantCandidates.push(
        await buildVariantRecord({
          product,
          reconciled,
          offer: null,
          offers: [],
          variantMeta,
          variantKey: variantMeta?.variant_key || null,
          enrichSpecifications
        })
      );
      if (variantCandidates.length > 0) break;
    }
  }

  variantCandidates.sort((a, b) => {
    const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''));
    if (nameDiff !== 0) return nameDiff;
    return String(a?.variantKey || a?.variantAsin || '').localeCompare(String(b?.variantKey || b?.variantAsin || ''));
  });

  const variantOptions = buildVariantOptions(variantCandidates);
  const variantCount = Math.max(variantCandidates.length, 1);
  const hasVariants = variantCount > 1;

  const summaryProduct = reconcileDiscoveryProductFields(
    enrichedProducts.find((p) => p.id === baseProduct.id) || baseProduct,
    offerAggregates
  );

  const priceSource =
    audienceRules.audience === DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM && viewerListings.length
      ? viewerListings
      : variantCandidates;
  const prices = priceSource
    .map((entry) => Number(entry?.price))
    .filter((n) => Number.isFinite(n) && n > 0);
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
    variants: variantCandidates,
    viewerListings
  };
}
