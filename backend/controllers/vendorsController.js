import express from 'express';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import {
  getAllowedSellerRoleForBrand,
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  buildNameSearchPatterns,
  detectItemBrand,
  detectProductBrandKey,
  fuzzyNameCompatible,
  hasModelTokenConflict
} from '../services/vendorRankingHelpersService.js';
import { inferMaterialCategory } from '../services/materialClassificationService.js';
import {
  assignSequentialRank,
  computeUrgencyBonus,
  filterTopValidVendors,
  prioritizeApprovedThenRankScore,
  sortVendorsByGeoThenRankScore
} from '../services/vendorRankingScoringService.js';
import { enrichItemVendorsWithLatestScorecards } from '../services/vendorScorecardService.js';
import { buildFallbackVendorFromReferenceProduct } from '../services/vendorReferenceFallbackService.js';
import { loadBuyerCovMetrics } from '../services/vendorBuyerMetricsService.js';
import {
  loadBoqContextForRanking,
  loadDiscoveryProjectContextForRanking,
  loadServiceProviderLocationContext,
  resolveProjectShippingAddress
} from '../services/vendorRequestContextService.js';
import { loadReferenceProductForItem } from '../services/vendorReferenceProductService.js';
import {
  reconcileWithSupplierOffers,
  searchRankableProductsForItem
} from '../services/vendorProductDiscoveryService.js';
import { buildSupplierProductsForRanking } from '../services/vendorSupplierAggregationService.js';
import { computeSupplierDistances } from '../services/vendorDistanceService.js';
import { mapSupplierProductsToRankedVendors } from '../services/vendorFinalRankingService.js';
import {
  computeAvailableStock,
  getActiveReservedQuantitiesByProductIds
} from '../services/checkoutInventoryReservationService.js';
import {
  logItemVendorResult,
  logNoVendorsDebug,
  logVendorRankingSummary
} from '../services/vendorRankingLoggingService.js';
import { vendorRankSchema } from '../contracts/vendorContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';

const router = express.Router();
const shouldIncludeAllVariantsForItem = ({ item = {}, itemName = '', referenceProduct = null }) => {
  void item;
  void itemName;
  void referenceProduct;
  // Service-provider selection must be variant-wise so buyers can compare
  // each supplier offer variant explicitly, even when BOQ name has model tokens.
  return true;
};

const vendorRankLogVerbose =
  process.env.NODE_ENV !== 'production' || String(process.env.VENDOR_RANK_VERBOSE || '').trim() === '1';
const rankLog = vendorRankLogVerbose ? (...args) => console.log(...args) : () => {};

router.post('/rank', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(vendorRankSchema, req.body || {});
    const { items, boqId, _timestamp, _random } = payload;
    const itemBrandCandidates = (items || [])
      .flatMap((item) => [
        item?.brand,
        item?.brandName,
        item?.brandModel,
        item?.specifications?.brand,
        item?.specifications?.brandModel
      ])
      .filter(Boolean);
    const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, itemBrandCandidates);

    const { siteGeoFromBoq: boqSiteGeo, boqProjectCity: boqCity, boqProjectState: boqState, requiredDateFromBoq: boqRequiredDate } =
      await loadBoqContextForRanking({
        supabase,
        boqId,
        userId: req.userId
      });

    const resolvedProject = await resolveProjectShippingAddress(payload.project || {}, {
      supabase,
      userId: req.userId
    });
    const discoveryContext = await loadDiscoveryProjectContextForRanking(resolvedProject);

    const prefersDiscoveryDelivery = Boolean(
      resolvedProject?.shippingAddress ||
        resolvedProject?.shippingAddressId ||
        String(resolvedProject?.location || '').trim() ||
        discoveryContext.deliveryLocation
    );

    let siteGeoFromBoq;
    let boqProjectCity;
    let boqProjectState;
    let requiredDateFromBoq;

    if (prefersDiscoveryDelivery) {
      siteGeoFromBoq = discoveryContext.siteGeoFromBoq;
      boqProjectCity = discoveryContext.boqProjectCity;
      boqProjectState = discoveryContext.boqProjectState;
      requiredDateFromBoq = discoveryContext.requiredDateFromBoq || boqRequiredDate;
      rankLog(
        `[Vendor Ranking] Ranking from cart/discovery delivery address: ${discoveryContext.deliveryLocation || 'n/a'}` +
          (siteGeoFromBoq ? ` (${siteGeoFromBoq.lat.toFixed(4)}, ${siteGeoFromBoq.lng.toFixed(4)})` : ' (geo pending)')
      );
    } else {
      siteGeoFromBoq = boqSiteGeo || discoveryContext.siteGeoFromBoq;
      boqProjectCity = boqCity || discoveryContext.boqProjectCity;
      boqProjectState = boqState || discoveryContext.boqProjectState;
      requiredDateFromBoq = boqRequiredDate || discoveryContext.requiredDateFromBoq;
    }
    
    rankLog(`\n[Vendor Ranking] ==========================================`);
    rankLog(`[Vendor Ranking] Vendor ranking request received at ${new Date().toISOString()}`);
    rankLog(`[Vendor Ranking] Timestamp: ${_timestamp}, Random: ${_random}`);
    rankLog(`[Vendor Ranking] Items received: ${items?.length || 0}`);
    rankLog(
      `[Vendor Ranking] Items structure:`,
      items?.map((item) => ({
        id: item.id,
        normalizedName: item.normalizedName,
        rawName: item.rawName,
        productId: item.productId,
        availableSuppliers: item.availableSuppliers
      }))
    );
    rankLog(`[Vendor Ranking] ==========================================\n`);
    
    // Detect service provider location from profile/address for proximity-based ranking
    const { serviceProviderCity, serviceProviderState } = await loadServiceProviderLocationContext({
      supabase,
      userId: req.userId
    });

    const itemVendors = {};
    const { platformCov, supplierCovById, brandCovByBrand } = await loadBuyerCovMetrics({
      supabase,
      userId: req.userId
    });

    // Rank each BOQ line in parallel (was sequential — very slow for large BOQs).
    const rankingResults = await Promise.all(
      items.map(async (item) => {
      const itemId = item.id?.toString() || String(item.id);
      // Try multiple possible field names for item name
      const itemName = item.normalizedName || item.rawName || item.name || item.description || item.itemName || '';
      
      rankLog(
        `[Vendor Ranking] Processing item ID: ${itemId}, Name: "${itemName}"`,
        vendorRankLogVerbose
          ? JSON.stringify(item)
          : { id: item.id, productId: item.productId, normalizedName: item.normalizedName }
      );

      if (!itemName || itemName.trim() === '') {
        rankLog(`[Vendor Ranking] Skipping item ${itemId}: No name found`);
        return { itemId, validVendors: [], itemName, vendors: [], referenceProduct: null };
      }

      // Determine category from item name
      const itemNameLower = itemName.toLowerCase();
      const itemCategory = inferMaterialCategory(itemNameLower);

      // BOQ normalization attaches productId; load that row for fallbacks and prioritization.
      let referenceProduct = null;
      if (item.productId) {
        const { referenceProduct: refProduct, error: refErr } = await loadReferenceProductForItem({
          supabase,
          productId: item.productId
        });
        if (refErr) {
          console.error(`[Vendor Ranking] Reference product fetch error for productId ${item.productId}:`, refErr);
        } else {
          referenceProduct = refProduct;
        }
      }

      const targetBrand = detectItemBrand(item, referenceProduct);
      const includeAllVariants = shouldIncludeAllVariantsForItem({
        item,
        itemName,
        referenceProduct
      });
      if (targetBrand) {
        rankLog(`[Vendor Ranking] Target retailer brand for item ${itemId}: ${targetBrand}`);
      }

      // Search products purely by name (and approximate category) to collect ALL supplier offers,
      // regardless of the specific normalized product_id.
      rankLog(`[Vendor Ranking] Searching products by name only: "${itemNameLower}" (category: ${itemCategory})`);
      let products = await searchRankableProductsForItem({
        supabase,
        item,
        itemId,
        itemName,
        itemNameLower,
        itemCategory,
        referenceProduct,
        buildNameSearchPatterns,
        fuzzyNameCompatible
      });

      products = await reconcileWithSupplierOffers({
        supabase,
        products,
        item,
        itemId,
        itemName,
        referenceProduct,
        includeAllVariants,
        targetBrand,
        detectProductBrandKey,
        fuzzyNameCompatible,
        hasModelTokenConflict
      });

      const preRetailCount = (products || []).length;
      products = (products || []).filter((p) => {
        const supplierProfile = p?.supplier?.profile;
        return supplierMatchesBrandTerminalRole(supplierProfile, targetBrand, terminalRoleByBrandMap);
      });
      if (preRetailCount !== (products || []).length) {
        rankLog(
          `[Vendor Ranking] Terminal-role + brand filter for item ${itemId}: ${products.length}/${preRetailCount} offers kept`
        );
      }

      rankLog(`[Vendor Ranking] Item "${itemName}": Found ${products?.length || 0} products`);
      if (products && products.length > 0) {
        rankLog(`[Vendor Ranking] Sample product structure:`, {
          id: products[0].id,
          name: products[0].name,
          hasSupplier: !!products[0].supplier,
          supplierId: products[0].supplier?.id,
          supplierName: products[0].supplier?.name,
          supplier_id: products[0].supplier_id,
          status: products[0].status
        });
      }

      const supplierProducts = await buildSupplierProductsForRanking({
        supabase,
        products,
        itemName,
        itemCategory,
        targetBrand,
        platformCov,
        supplierCovById,
        brandCovByBrand
      });

      const {
        distanceBySupplier,
        distanceSourceLocationBySupplier,
        distanceByOutletId,
        distanceSourceLocationByOutletId
      } = await computeSupplierDistances({
        supabase,
        supplierProducts,
        siteGeoFromBoq
      });

      const urgencyBonus = computeUrgencyBonus(requiredDateFromBoq);

      const offerIds = Object.values(supplierProducts || {}).flatMap((supplier) =>
        (supplier?.products || [])
          .map((product) => product?.supplierProductId)
          .filter(Boolean)
      );
      const reservedQtyByProductId = await getActiveReservedQuantitiesByProductIds(offerIds);

      // Convert to array and calculate ranking score
      const vendors = mapSupplierProductsToRankedVendors({
        supplierProducts,
        reservedQtyByProductId,
        siteGeoFromBoq,
        distanceBySupplier,
        distanceSourceLocationBySupplier,
        distanceByOutletId,
        distanceSourceLocationByOutletId,
        boqProjectCity,
        serviceProviderCity,
        boqProjectState,
        serviceProviderState,
        urgencyBonus,
        itemName,
        itemCategory,
        includeAllVariants
      });

      // Sort primarily by proximity when site geo is known, then by overall rank score.
      sortVendorsByGeoThenRankScore(vendors, siteGeoFromBoq);

      // Without delivery coordinates, keep legacy approved-first + stock-weighted ordering.
      if (!siteGeoFromBoq) {
        prioritizeApprovedThenRankScore(vendors);
      }

      const rankCap = includeAllVariants ? 500 : 50;
      let validVendors = filterTopValidVendors(vendors, rankCap, {
        preserveGeoOrder: !!siteGeoFromBoq
      });

      assignSequentialRank(validVendors);
      if (siteGeoFromBoq && validVendors.length > 0) {
        const preferredSupplierId =
          String(item?.nearestSupplier?.supplierId || '').trim() ||
          String(item?.supplyChainLastSupplier?.supplierId || '').trim() ||
          '';
        const withDistance = validVendors.filter((vendor) => typeof vendor?.distanceKm === 'number');
        const inStockWithDistance = withDistance.filter((vendor) => Number(vendor?.stock || 0) > 0);
        const preferredWithDistance = preferredSupplierId
          ? withDistance.filter((vendor) => String(vendor?.id || '') === preferredSupplierId)
          : [];
        const preferredInStockWithDistance = preferredWithDistance.filter(
          (vendor) => Number(vendor?.stock || 0) > 0
        );

        const pickNearestFrom = (list) =>
          list.reduce((best, vendor) =>
            (vendor.distanceKm || Infinity) < (best.distanceKm || Infinity) ? vendor : best
          );

        const nearestRecommended =
          (preferredInStockWithDistance.length > 0 && pickNearestFrom(preferredInStockWithDistance)) ||
          (inStockWithDistance.length > 0 && pickNearestFrom(inStockWithDistance)) ||
          (preferredWithDistance.length > 0 && pickNearestFrom(preferredWithDistance)) ||
          (withDistance.length > 0 && pickNearestFrom(withDistance)) ||
          validVendors[0];

        validVendors.forEach((vendor) => {
          delete vendor.isNearestRecommended;
        });
        if (nearestRecommended) {
          nearestRecommended.isNearestRecommended = true;
        }
      }
      
      // CRITICAL: If we have a reference product with a supplier but no vendors were found,
      // create a vendor entry from the reference product to ensure it's shown
      if (validVendors.length === 0 && referenceProduct && referenceProduct.supplier && referenceProduct.supplier.id) {
        const refSupplierProfile = referenceProduct.supplier.profile;
        const refBrandAllowed = supplierMatchesBrandTerminalRole(
          refSupplierProfile,
          targetBrand,
          terminalRoleByBrandMap
        );
        if (!refBrandAllowed) {
          const requiredRole = getAllowedSellerRoleForBrand(targetBrand, terminalRoleByBrandMap);
          const requiredRoleText = requiredRole || 'admin chain terminal role is not configured';
          rankLog(
            `[Vendor Ranking] Reference product supplier is not eligible for terminal role "${requiredRoleText}" and brand "${targetBrand || 'n/a'}"; skipping synthetic vendor for item ${itemId}`
          );
        } else {
        rankLog(`[Vendor Ranking] No vendors found but reference product has supplier, creating vendor entry...`);
        const fallbackVendor = buildFallbackVendorFromReferenceProduct({ referenceProduct, itemCategory });
        if (fallbackVendor) {
          validVendors = [fallbackVendor];
          rankLog(`[Vendor Ranking] Created vendor entry from reference product: ${validVendors[0].name}`);
        } else {
          rankLog(`[Vendor Ranking] Reference product has invalid stock/price, cannot create vendor entry`);
        }
        }
      }
      
      return { itemId, validVendors, itemName, vendors, referenceProduct };
      })
    );

    for (const { itemId, validVendors, itemName, vendors, referenceProduct } of rankingResults) {
      itemVendors[itemId] = validVendors;
      logItemVendorResult({ itemId, itemName, validVendors });
      if (validVendors.length === 0) {
        logNoVendorsDebug({ itemId, itemName, vendors, referenceProduct });
      }
    }

    // Attach latest vendor scorecards (if available) to influence procurement decisions.
    try {
      await enrichItemVendorsWithLatestScorecards({ supabase, itemVendors });
    } catch (scoreErr) {
      console.error('[Vendor Ranking] scorecard enrichment failed:', scoreErr);
    }

    // Log summary before returning
    logVendorRankingSummary({ items, itemVendors });
    
    res.json({ itemVendors });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Vendor Ranking] Vendor ranking error:', error);
    console.error('[Vendor Ranking] Error stack:', error.stack);
    res.status(500).json({
      status: 'error',
      message: 'Failed to rank vendors',
      error: error.message
    });
  }
});

export { router as vendorRouter };
