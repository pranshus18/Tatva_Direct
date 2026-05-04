import { computeLocationScore } from './vendorRankingScoringService.js';

export function mapSupplierProductsToRankedVendors({
  supplierProducts,
  siteGeoFromBoq,
  distanceBySupplier,
  distanceSourceLocationBySupplier,
  boqProjectCity,
  serviceProviderCity,
  boqProjectState,
  serviceProviderState,
  urgencyBonus,
  itemName,
  itemCategory
}) {
  return Object.values(supplierProducts).map((supplier, index) => {
    const priceScore = 100 - supplier.bestPrice / 100;
    const ratingScore = (supplier.bestRating / 5) * 30;
    const stockScore = Math.min((supplier.totalStock / 1000) * 20, 20);

    const supplierId = supplier.supplierId;
    const distanceKm = siteGeoFromBoq && distanceBySupplier[supplierId] != null ? distanceBySupplier[supplierId] : null;
    const distanceSourceLocation = distanceSourceLocationBySupplier[supplierId] || null;
    const displayLocation =
      supplier.supplierLocation && supplier.supplierLocation !== 'Location not specified'
        ? supplier.supplierLocation
        : distanceSourceLocation || supplier.supplierLocation;

    const locationScore = computeLocationScore({
      siteGeoFromBoq,
      distanceKm,
      supplierLocation: supplier.supplierLocation,
      boqProjectCity,
      serviceProviderCity,
      boqProjectState,
      serviceProviderState
    });

    const rankScore = priceScore + ratingScore + stockScore + locationScore + urgencyBonus;
    const leadTime = supplier.totalStock > 500 ? 2 : supplier.totalStock > 100 ? 3 : 5;

    const bestProduct = supplier.products.sort((a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0))[0];
    const productPrice = parseFloat(bestProduct?.price) || supplier.bestPrice;
    const supplierProductName = bestProduct?.name || null;
    const productDescription = bestProduct?.description || '';
    const productImages = Array.isArray(bestProduct?.images) ? bestProduct.images.filter(Boolean) : [];
    const productUnit = bestProduct?.unit || 'nos';
    const productCategory = bestProduct?.category || itemCategory;
    const productIdentification = bestProduct?.productIdentification || null;

    return {
      id: supplier.supplierId,
      name: supplier.supplierName,
      company: supplier.supplierCompany,
      location: displayLocation,
      distanceSourceLocation,
      price: productPrice,
      basePrice: parseFloat(bestProduct?.basePrice) || productPrice,
      bcovApplied: !!bestProduct?.bcovApplied,
      bcovLevelId: bestProduct?.bcovLevelId || null,
      leadTime,
      rank: index + 1,
      rating: supplier.bestRating,
      stock: supplier.totalStock,
      productCount: supplier.products.length,
      rankScore,
      distanceKm,
      productName: itemName,
      supplierProductName,
      images: productImages,
      productImage: productImages[0] || null,
      productId: bestProduct?.id || null,
      productIdentification,
      unit: productUnit,
      category: productCategory,
      description: productDescription,
      isAvailable: supplier.totalStock > 0,
      status: supplier.hasApprovedProduct ? 'approved' : 'pending'
    };
  });
}
