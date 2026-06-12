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
 * Persist uploaded offer images on the shared catalog row so buyer discovery can show thumbnails.
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

  const merged = mergeProductImageLists(row?.images, incoming);
  const { error: updateError } = await supabase
    .from('products')
    .update({ images: merged, updated_at: new Date().toISOString() })
    .eq('id', productId);

  if (updateError) {
    console.error('syncCatalogProductImages update failed:', updateError.message);
    return merged;
  }

  return merged;
}

/**
 * Fill missing catalog images from approved supplier offer attributes (buyer listings).
 */
export async function enrichProductsWithOfferImages(supabase, products = []) {
  const rows = Array.isArray(products) ? products : [];
  const productIds = [...new Set(rows.map((p) => p?.id).filter(Boolean))];
  if (!productIds.length) return rows;

  const { data: offerRows, error } = await supabase
    .from('supplier_products')
    .select('product_id, attributes, status, is_active, updated_at')
    .in('product_id', productIds)
    .eq('status', 'approved')
    .eq('is_active', true);

  if (error) {
    console.error('enrichProductsWithOfferImages failed:', error.message);
    return rows;
  }

  const imagesByProductId = new Map();
  for (const offer of offerRows || []) {
    const productId = offer?.product_id;
    if (!productId) continue;
    const offerImages = sanitizeImageUrls(offer?.attributes?.images);
    if (!offerImages.length) continue;
    const existing = imagesByProductId.get(productId) || [];
    imagesByProductId.set(productId, mergeProductImageLists(existing, offerImages));
  }

  return rows.map((product) => {
    const catalogImages = sanitizeImageUrls(product?.images);
    const offerImages = imagesByProductId.get(product.id) || [];
    const merged = mergeProductImageLists(offerImages, catalogImages);
    if (!merged.length) return product;
    return { ...product, images: merged };
  });
}
