import { computeLocationScore } from './vendorRankingScoringService.js';
import { computeAvailableStock } from './checkoutInventoryReservationService.js';
import { compactLocationText, isPlaceholderLocationText } from './vendorRankingHelpersService.js';

export function mapSupplierProductsToRankedVendors({
  supplierProducts,
  reservedQtyByProductId = null,
  siteGeoFromBoq,
  distanceBySupplier,
  distanceSourceLocationBySupplier,
  distanceByOutletId = {},
  distanceSourceLocationByOutletId = {},
  distanceByLocationText = {},
  distanceSourceLocationByLocationText = {},
  boqProjectCity,
  serviceProviderCity,
  boqProjectState,
  serviceProviderState,
  urgencyBonus,
  itemName,
  itemCategory,
  includeAllVariants = false
}) {
  const rankedVendors = [];
  Object.values(supplierProducts).forEach((supplier, index) => {
    const priceScore = 100 - supplier.bestPrice / 100;
    const ratingScore = (supplier.bestRating / 5) * 30;
    const stockScore = Math.min((supplier.totalStock / 1000) * 20, 20);

    const supplierId = supplier.supplierId;
    const supplierDistanceKm =
      siteGeoFromBoq && distanceBySupplier[supplierId] != null ? distanceBySupplier[supplierId] : null;
    const supplierDistanceSourceLocation = distanceSourceLocationBySupplier[supplierId] || null;

    const rankScore = priceScore + ratingScore + stockScore + urgencyBonus;
    const leadTime = supplier.totalStock > 500 ? 2 : supplier.totalStock > 100 ? 3 : 5;
    const sortedProducts = [...(supplier.products || [])].sort(
      (a, b) => (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0)
    );
    const productsToEmit = includeAllVariants ? sortedProducts : sortedProducts.slice(0, 1);
    productsToEmit.forEach((bestProduct) => {
      if (!bestProduct) return;
      // Prefer the distance/location tied to THIS specific offer over the supplier-wide
      // fallback — two offers from the same supplier account can genuinely ship from
      // different physical locations, so they must not share one distance. Priority:
      // 1) an exact outlet_id match, 2) this offer's own listed location text geocoded
      // individually, 3) the supplier-wide fallback (account address / nearest outlet).
      const offerOutletId = bestProduct?.outlet_id || null;
      const hasExactOutletDistance = offerOutletId && distanceByOutletId[offerOutletId] != null;
      const offerLocationKey = compactLocationText(bestProduct?.location).toLowerCase();
      const hasOwnLocationDistance =
        !hasExactOutletDistance && offerLocationKey && distanceByLocationText[offerLocationKey] != null;
      const distanceKm = siteGeoFromBoq
        ? hasExactOutletDistance
          ? distanceByOutletId[offerOutletId]
          : hasOwnLocationDistance
            ? distanceByLocationText[offerLocationKey]
            : supplierDistanceKm
        : null;
      const distanceSourceLocation = hasExactOutletDistance
        ? distanceSourceLocationByOutletId[offerOutletId] || null
        : hasOwnLocationDistance
          ? distanceSourceLocationByLocationText[offerLocationKey] || null
          : supplierDistanceSourceLocation;
      // Show THIS offer's own listed location/pincode (not a value borrowed from a different
      // product of the same supplier) — a supplier can list products from different outlets,
      // and the card must always describe the specific item being shown.
      const offerLocationText = String(bestProduct?.location || '').trim();
      const offerPincodeMatch = offerLocationText.match(/\b(\d{6})\b/);
      const offerPincode = offerPincodeMatch ? offerPincodeMatch[1] : null;
      const displayLocation = !isPlaceholderLocationText(offerLocationText)
        ? offerLocationText
        : !isPlaceholderLocationText(supplier.supplierLocation)
          ? supplier.supplierLocation
          : distanceSourceLocation || supplier.supplierLocation;
      const displayPincode = offerPincode || supplier.supplierPincode || null;

      const locationScore = computeLocationScore({
        siteGeoFromBoq,
        distanceKm,
        supplierLocation: supplier.supplierLocation,
        boqProjectCity,
        serviceProviderCity,
        boqProjectState,
        serviceProviderState
      });
      const finalRankScore = rankScore + locationScore;
    const productPrice = parseFloat(bestProduct?.price) || supplier.bestPrice;
    const supplierProductName = bestProduct?.name || null;
    const productDescription = bestProduct?.description || '';
    const productImages = Array.isArray(bestProduct?.images) ? bestProduct.images.filter(Boolean) : [];
    const productUnit = bestProduct?.unit || 'nos';
    const productCategory = bestProduct?.category || itemCategory;
    const productIdentification = bestProduct?.productIdentification || null;
    const productSpecifications =
      bestProduct?.specifications &&
      typeof bestProduct.specifications === 'object' &&
      !Array.isArray(bestProduct.specifications)
        ? bestProduct.specifications
        : {};
      const isOfferApproved =
        bestProduct?.status === 'approved' || bestProduct?.sharedProductStatus === 'approved';
      const selectionId = bestProduct?.supplierProductId || `${supplier.supplierId}:${bestProduct?.id || 'offer'}`;
      const onHandStock = parseInt(bestProduct?.stock, 10) || 0;
      const reservedQty =
        reservedQtyByProductId instanceof Map
          ? reservedQtyByProductId.get(bestProduct?.supplierProductId) || 0
          : 0;
      const availableStock = computeAvailableStock(onHandStock, reservedQty);
      rankedVendors.push({
      id: supplier.supplierId,
      selectionId,
      name: supplier.supplierName,
      company: supplier.supplierCompany,
      location: displayLocation,
      pincode: displayPincode,
      supplierPincode: displayPincode,
      distanceSourceLocation,
      price: productPrice,
      basePrice: parseFloat(bestProduct?.basePrice) || productPrice,
      bcovApplied: !!bestProduct?.bcovApplied,
      bcovLevelId: bestProduct?.bcovLevelId || null,
      leadTime,
      rank: index + 1,
      rating: supplier.bestRating,
      stock: availableStock,
      availableStock,
      productCount: supplier.products.length,
      rankScore: finalRankScore,
      distanceKm,
      productName: itemName,
      supplierProductName,
      images: productImages,
      productImage: productImages[0] || null,
      supplierProductId: bestProduct?.supplierProductId || null,
      asin: bestProduct?.asin || bestProduct?.parentAsin || null,
      parentAsin: bestProduct?.asin || bestProduct?.parentAsin || null,
      variantKey: bestProduct?.supplierVariantKey || bestProduct?.variant_key || null,
      variantAsin: bestProduct?.supplierVariantAsin || bestProduct?.variantAsin || bestProduct?.variant_asin || null,
      productId: bestProduct?.id || null,
      productIdentification,
      unit: productUnit,
      category: productCategory,
      description: productDescription,
      specifications: productSpecifications,
      isAvailable: availableStock > 0,
      status: isOfferApproved || supplier.hasApprovedProduct ? 'approved' : 'pending'
      });
    });
  });
  return rankedVendors;
}
