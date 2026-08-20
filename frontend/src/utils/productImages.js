/** Normalize product image URLs from API payloads (array, JSON string, or single URL). */
export function normalizeProductImages(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return [...new Set(input.map((item) => String(item || '').trim()).filter((url) => /^https?:\/\//i.test(url)))];
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return normalizeProductImages(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
  }
  return [];
}

/**
 * Images belonging to this supplier offer (not shared catalog history).
 * Prefer attributes.images so catalog/old photos do not leak into add/edit forms.
 * An explicit empty attributes.images array means the supplier cleared photos — do not
 * fall back to catalog/product.images.
 */
export function getSupplierOfferImagesForForm(product) {
  if (!product) return [];
  if (Array.isArray(product?.attributes?.images)) {
    return normalizeProductImages(product.attributes.images);
  }
  const fromAttributes = normalizeProductImages(product?.attributes?.images);
  if (fromAttributes.length > 0) return fromAttributes;
  return [];
}

/** First image URL for thumbnails; prefers supplier offer images when present on the row. */
export function getProductImageList(product) {
  if (!product) return [];
  if (Array.isArray(product?.attributes?.images)) {
    return normalizeProductImages(product.attributes.images);
  }
  const fromAttributes = normalizeProductImages(product?.attributes?.images);
  if (fromAttributes.length > 0) return fromAttributes;
  const direct = normalizeProductImages(product.images);
  if (direct.length > 0) return direct;
  const single = product?.image ? normalizeProductImages([product.image]) : [];
  return single;
}

/**
 * Gallery for the seller currently being viewed. Uses only that listing's photos.
 * Never fall back to a catalog/product summary — `products.images` is every supplier's
 * uploads merged together.
 */
export function getSelectedListingImages(listing) {
  if (!listing) return [];
  if (Array.isArray(listing.attributes?.images)) {
    return normalizeProductImages(listing.attributes.images);
  }
  const fromAttributes = normalizeProductImages(listing.attributes?.images);
  if (fromAttributes.length > 0) return fromAttributes;
  return normalizeProductImages(listing.images);
}

/**
 * Order-line carousel images: only the ordered variant/offer photos.
 * Never use item.product.images — that is the shared catalog gallery merged across variants.
 */
export function getOrderItemImages(item) {
  if (!item) return [];
  if (Array.isArray(item.images)) {
    return normalizeProductImages(item.images);
  }
  if (item.productImage) {
    return normalizeProductImages([item.productImage]);
  }
  if (item.product?.image) {
    return normalizeProductImages([item.product.image]);
  }
  return [];
}

export function getProductThumbnailUrl(product) {
  return getProductImageList(product)[0] || '';
}
