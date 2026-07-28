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
 */
export function getSupplierOfferImagesForForm(product) {
  if (!product) return [];
  const fromAttributes = normalizeProductImages(product?.attributes?.images);
  if (fromAttributes.length > 0) return fromAttributes;
  return normalizeProductImages(product.images);
}

/** First image URL for thumbnails; prefers supplier offer images when present on the row. */
export function getProductImageList(product) {
  if (!product) return [];
  const fromAttributes = normalizeProductImages(product?.attributes?.images);
  if (fromAttributes.length > 0) return fromAttributes;
  const direct = normalizeProductImages(product.images);
  if (direct.length > 0) return direct;
  const single = product?.image ? normalizeProductImages([product.image]) : [];
  return single;
}

export function getProductThumbnailUrl(product) {
  return getProductImageList(product)[0] || '';
}
