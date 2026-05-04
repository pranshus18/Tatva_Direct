import { buildProductIdentification } from './procurementSharedService.js';

export function buildFallbackVendorFromReferenceProduct({ referenceProduct, itemCategory }) {
  const refSupplier = referenceProduct?.supplier;
  if (!referenceProduct || !refSupplier || !refSupplier.id) return null;

  const refPrice = parseFloat(referenceProduct.price) || 0;
  const refStock = referenceProduct.stock || 0;
  const refRating = parseFloat(referenceProduct.average_rating) || 0;
  if (!(refStock > 0 || refPrice > 0)) return null;

  const leadTime = refStock > 500 ? 2 : refStock > 100 ? 3 : 5;
  const location =
    referenceProduct.location ||
    (refSupplier.address ? `${refSupplier.address.city || ''}, ${refSupplier.address.state || ''}`.trim() : 'Location not specified') ||
    'Location not specified';

  return {
    id: refSupplier.id,
    name: refSupplier.name || refSupplier.company || 'Unknown Supplier',
    company: refSupplier.company || '',
    location,
    price: refPrice,
    leadTime,
    rank: 1,
    rating: refRating,
    stock: refStock,
    productCount: 1,
    rankScore: 100,
    distanceKm: null,
    productName: referenceProduct.name,
    images: Array.isArray(referenceProduct.images) ? referenceProduct.images.filter(Boolean) : [],
    productImage:
      Array.isArray(referenceProduct.images) && referenceProduct.images.length > 0
        ? referenceProduct.images[0]
        : null,
    productId: referenceProduct.id,
    productIdentification: buildProductIdentification({
      skuNo:
        referenceProduct?.specifications?.skuNo ||
        referenceProduct?.specifications?.sku ||
        referenceProduct?.specifications?.gsku,
      modelBrand: referenceProduct?.specifications?.modelBrand || referenceProduct?.specifications?.brand
    }),
    unit: referenceProduct.unit || 'nos',
    category: referenceProduct.category || itemCategory,
    description: referenceProduct.description || '',
    isAvailable: refStock > 0,
    status: referenceProduct.status === 'approved' ? 'approved' : 'pending'
  };
}
