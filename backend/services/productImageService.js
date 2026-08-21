import { sanitizeImageUrls } from '../controllers/supplier/shared/productHelpers.js';

/** Merge image URL lists; offer/supplier images should be passed first. */
export function mergeProductImageLists(...lists) {
  const merged = [];
  for (const list of lists) {
    merged.push(...sanitizeImageUrls(list));
  }
  return sanitizeImageUrls(merged);
}

/**
 * Supplier portal / offer responses must show only this offer's photos when present.
 * Do not merge shared catalog history into the supplier's listing (that leaked "old" images
 * into add/edit flows).
 *
 * An explicit array (including []) means the offer owns its image list — e.g. the supplier
 * deleted every photo. Fall back to catalog only when offer images were never set (null/undefined).
 */
export function resolveSupplierOfferDisplayImages(offerImages, catalogImages = []) {
  if (Array.isArray(offerImages)) {
    return sanitizeImageUrls(offerImages);
  }
  const offer = sanitizeImageUrls(offerImages);
  if (offer.length > 0) return offer;
  return sanitizeImageUrls(catalogImages);
}

function parseOfferAttributes(attributes) {
  if (!attributes) return {};
  if (typeof attributes === 'string') {
    try {
      const parsed = JSON.parse(attributes);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
}

function collectOfferImageUrls(row) {
  return sanitizeImageUrls(parseOfferAttributes(row?.attributes)?.images);
}

/**
 * Product-detail / card gallery for the seller who listed this offer.
 * Only this offer's stored photos. Never `products.images` (every supplier merged).
 * If this offer copied that shared dump onto attributes.images, drop it.
 */
export function resolveSellerOwnedListingImages({
  offer = null,
  catalogProductOffers = [],
  catalogImages = []
} = {}) {
  if (!offer) return [];

  const attrs = parseOfferAttributes(offer.attributes);
  if (Array.isArray(attrs.images) && attrs.images.length === 0) {
    return [];
  }

  const mine = sanitizeImageUrls(attrs.images);
  if (!mine.length) return [];

  const catalog = sanitizeImageUrls(catalogImages);
  const supplierId = String(offer.supplier_id || '').trim();
  const offerId = String(offer.id || '').trim();
  const siblings = Array.isArray(catalogProductOffers) ? catalogProductOffers : [];

  const otherUrls = new Set();
  let otherSellerCount = 0;
  const seenOtherSuppliers = new Set();

  for (const row of siblings) {
    const rowId = String(row?.id || '').trim();
    const rowSupplier = String(row?.supplier_id || '').trim();
    const sameOffer = Boolean(offerId && rowId && rowId === offerId);
    const sameSupplier = Boolean(supplierId && rowSupplier && rowSupplier === supplierId);
    if (sameOffer || sameSupplier) continue;
    if (rowSupplier && !seenOtherSuppliers.has(rowSupplier)) {
      seenOtherSuppliers.add(rowSupplier);
      otherSellerCount += 1;
    } else if (!rowSupplier && rowId) {
      otherSellerCount += 1;
    }
    for (const url of collectOfferImageUrls(row)) otherUrls.add(url);
  }

  const uniqueMine = mine.filter((url) => !otherUrls.has(url));
  const copiedCatalogDump =
    otherSellerCount > 0 &&
    catalog.length > 1 &&
    mine.length >= catalog.length &&
    catalog.every((url) => mine.includes(url));

  if (copiedCatalogDump) {
    return uniqueMine.length < mine.length ? uniqueMine : [];
  }

  const coversOtherSellers =
    otherUrls.size > 0 && [...otherUrls].every((url) => mine.includes(url));
  if (coversOtherSellers && uniqueMine.length < mine.length) {
    return uniqueMine;
  }

  return mine;
}

/**
 * Images for a placed order line: prefer the immutable snapshot, then the ordered
 * supplier-offer / variant gallery. Never fall back to the merged catalog gallery when
 * the line is tied to a supplier offer — catalog.images accumulates every variant.
 */
export function resolveOrderLineDisplayImages({
  snapshotImages,
  offerImages,
  catalogImages = [],
  hasSupplierOffer = false
} = {}) {
  if (Array.isArray(snapshotImages)) {
    return sanitizeImageUrls(snapshotImages);
  }
  if (hasSupplierOffer || (offerImages !== undefined && offerImages !== null)) {
    return resolveSupplierOfferDisplayImages(offerImages, []);
  }
  return sanitizeImageUrls(catalogImages);
}

/**
 * Attach per-variant images onto order_items so order UIs do not show the shared
 * catalog gallery (products.images) that merges photos across variants.
 */
export async function enrichOrderItemsWithVariantImages(supabase, orderItems = []) {
  const items = Array.isArray(orderItems) ? orderItems : [];
  const supplierProductIds = [
    ...new Set(items.map((it) => it?.supplier_product_id).filter(Boolean))
  ];

  const offerById = new Map();
  if (supabase && supplierProductIds.length) {
    const { data, error } = await supabase
      .from('supplier_products')
      .select('id, attributes')
      .in('id', supplierProductIds);
    if (error) {
      console.error('enrichOrderItemsWithVariantImages failed:', error.message);
    } else {
      for (const row of data || []) {
        if (row?.id) offerById.set(row.id, row);
      }
    }
  }

  return items.map((it) => {
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

    const offer = it?.supplier_product_id ? offerById.get(it.supplier_product_id) : null;
    const images = resolveOrderLineDisplayImages({
      snapshotImages: snapshot?.images,
      offerImages: offer?.attributes?.images,
      catalogImages: it?.product?.images,
      hasSupplierOffer: Boolean(it?.supplier_product_id)
    });

    const product = it?.product
      ? {
          ...it.product,
          // Overwrite merged catalog gallery so clients cannot re-leak it.
          images,
          image: images[0] || it.product.image || null
        }
      : it?.product;

    return {
      ...it,
      product,
      images,
      productImage: images[0] || null
    };
  });
}

/**
 * Seed catalog thumbnails from the first offer that uploads photos.
 * Do not accumulate later sellers onto `products.images` — that dump leaked into every listing.
 */
export async function syncCatalogProductImages(supabase, productId, candidateImages = []) {
  if (!productId) return [];
  const incoming = sanitizeImageUrls(candidateImages);
  if (!incoming.length) return [];

  const { data: row, error: fetchError } = await supabase
    .from('products')
    .select('images')
    .eq('id', productId)
    .maybeSingle();

  if (fetchError) {
    console.error('syncCatalogProductImages fetch failed:', fetchError.message);
    return incoming;
  }

  const existing = sanitizeImageUrls(row?.images);
  if (existing.length > 0) return existing;

  const { error: updateError } = await supabase
    .from('products')
    .update({ images: incoming, updated_at: new Date().toISOString() })
    .eq('id', productId);

  if (updateError) {
    console.error('syncCatalogProductImages update failed:', updateError.message);
    return incoming;
  }

  return incoming;
}

/**
 * Discovery list cards: one selling listing's photos, never every supplier merged.
 */
export async function enrichProductsWithOfferImages(supabase, products = []) {
  const rows = Array.isArray(products) ? products : [];
  const productIds = [...new Set(rows.map((p) => p?.id).filter(Boolean))];
  if (!productIds.length) return rows;

  const { data: offerRows, error } = await supabase
    .from('supplier_products')
    .select('id, product_id, supplier_id, price, stock, attributes, status, is_active, updated_at')
    .in('product_id', productIds)
    .eq('status', 'approved')
    .eq('is_active', true);

  if (error) {
    console.error('enrichProductsWithOfferImages failed:', error.message);
    return rows.map((product) => ({ ...product, images: [] }));
  }

  const offersByProductId = new Map();
  for (const offer of offerRows || []) {
    const productId = offer?.product_id;
    if (!productId) continue;
    if (!offersByProductId.has(productId)) offersByProductId.set(productId, []);
    offersByProductId.get(productId).push(offer);
  }

  return rows.map((product) => {
    const catalogProductOffers = offersByProductId.get(product.id) || [];
    let preferred = null;
    for (const row of catalogProductOffers) {
      if (!preferred) {
        preferred = row;
        continue;
      }
      const stock = Number.parseInt(String(row?.stock ?? 0), 10) || 0;
      const preferredStock = Number.parseInt(String(preferred?.stock ?? 0), 10) || 0;
      if (stock > preferredStock) {
        preferred = row;
        continue;
      }
      if (stock < preferredStock) continue;
      const price = Number.parseFloat(String(row?.price ?? 0)) || 0;
      const preferredPrice = Number.parseFloat(String(preferred?.price ?? 0)) || 0;
      if (price > 0 && (preferredPrice <= 0 || price < preferredPrice)) {
        preferred = row;
      }
    }
    let images = resolveSellerOwnedListingImages({
      offer: preferred,
      catalogProductOffers,
      catalogImages: product?.images
    });
    if (!images.length) {
      for (const row of catalogProductOffers) {
        images = resolveSellerOwnedListingImages({
          offer: row,
          catalogProductOffers,
          catalogImages: product?.images
        });
        if (images.length) break;
      }
    }
    return {
      ...product,
      images
    };
  });
}
