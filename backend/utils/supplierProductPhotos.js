import { sanitizeImageUrls } from '../controllers/supplier/shared/productHelpers.js';

export const MIN_SUPPLIER_PRODUCT_PHOTOS = 1;

export function countSupplierProductPhotos(images) {
  return sanitizeImageUrls(images).length;
}

/**
 * Enforce the minimum product photo requirement for supplier product creation.
 */
export function validateMinSupplierProductPhotos(
  images,
  { minPhotos = MIN_SUPPLIER_PRODUCT_PHOTOS } = {}
) {
  const count = countSupplierProductPhotos(images);
  if (count >= minPhotos) {
    return {
      ok: true,
      count,
      missingFields: [],
      message: ''
    };
  }

  const stillNeeded = minPhotos - count;
  return {
    ok: false,
    count,
    missingFields: ['images'],
    message:
      count === 0
        ? minPhotos === 1
          ? 'At least 1 product photo is required before submitting. Please upload a product photo.'
          : `At least ${minPhotos} product photos are required before submitting. Please upload ${minPhotos} photos (for example front, side, and label).`
        : `At least ${minPhotos} product photo${minPhotos === 1 ? '' : 's'} ${minPhotos === 1 ? 'is' : 'are'} required. You currently have ${count}. Please upload ${stillNeeded} more photo${stillNeeded === 1 ? '' : 's'}.`
  };
}

export default {
  MIN_SUPPLIER_PRODUCT_PHOTOS,
  countSupplierProductPhotos,
  validateMinSupplierProductPhotos
};
