import {
  buildProductIdentification,
  firstNonEmpty,
  normalizeBrandKey,
  parseFiniteNumber,
  resolveBcovPriceForBuyerMetrics
} from './procurementSharedService.js';
import { supplierLocationCandidates, uniqueLocationList } from './vendorRankingHelpersService.js';

const NON_SPEC_ATTRIBUTE_KEYS = new Set([
  'description',
  'name',
  'category',
  'brandModel',
  'brand',
  'mpn',
  'gtin',
  'lsa',
  'hsnCode',
  'sku',
  'packSize',
  'unit',
  'variantAttributes',
  'igstRate',
  'cgstRate',
  'sgstRate',
  'tags',
  'images',
  'listingName',
  'specifications',
  'specification',
  'specs'
]);

export async function buildSupplierProductsForRanking({
  supabase,
  products,
  itemName,
  itemCategory,
  targetBrand,
  platformCov,
  supplierCovById,
  brandCovByBrand
}) {
  const productSupplierIds = [...new Set((products || []).map((p) => p?.supplier?.id).filter(Boolean))];
  const bcovBySupplierBrand = new Map();
  if (productSupplierIds.length > 0) {
    const { data: bcovRows, error: bcovError } = await supabase
      .from('supplier_bcov_levels')
      .select('id, supplier_id, normalized_brand, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .in('supplier_id', productSupplierIds);
    if (bcovError) {
      console.error('[Vendor Ranking] BCOV preload error:', bcovError);
    } else {
      for (const row of bcovRows || []) {
        const key = `${row.supplier_id}::${row.normalized_brand}`;
        if (!bcovBySupplierBrand.has(key)) bcovBySupplierBrand.set(key, []);
        bcovBySupplierBrand.get(key).push(row);
      }
      for (const [key, levels] of bcovBySupplierBrand.entries()) {
        levels.sort(
          (a, b) => (parseFiniteNumber(b.min_purchase_qty) || 0) - (parseFiniteNumber(a.min_purchase_qty) || 0)
        );
        bcovBySupplierBrand.set(key, levels);
      }
    }
  }

  const productsList = products || [];
  const missingSupplierIds = [
    ...new Set(
      productsList
        .filter((p) => p && (!p.supplier || !p.supplier.id) && p.supplier_id)
        .map((p) => p.supplier_id)
        .filter(Boolean)
    )
  ];

  const supplierById = new Map();
  if (missingSupplierIds.length > 0) {
    const { data: supplierRows, error: supplierBatchError } = await supabase
      .from('users')
      .select('id, name, company, email, phone, address, profile')
      .in('id', missingSupplierIds)
      .eq('user_type', 'supplier');
    if (supplierBatchError) {
      console.error('[Vendor Ranking] Batch supplier preload error:', supplierBatchError);
    } else {
      for (const row of supplierRows || []) {
        if (row?.id) supplierById.set(row.id, row);
      }
    }
  }

  const supplierProducts = {};
  for (const product of productsList) {
    if (!product.supplier || !product.supplier.id) {
      if (product.supplier_id) {
        const supplierData = supplierById.get(product.supplier_id);
        if (supplierData) {
          product.supplier = supplierData;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    const supplierId = product.supplier.id;
    const supplierAddress = product.supplier.address || {};
    const basePrice = parseFloat(product.price) || 0;
    const productBrandKey = normalizeBrandKey(
      product?.attributes?.brandModel ||
        product?.attributes?.brand ||
        product?.specifications?.brandModel ||
        product?.specifications?.brand ||
        product?.brand ||
        targetBrand
    );
    const bcovLevels = bcovBySupplierBrand.get(`${supplierId}::${productBrandKey}`) || [];
    const bcovResolved = resolveBcovPriceForBuyerMetrics({
      levels: bcovLevels,
      supplierCov: parseFiniteNumber(supplierCovById.get(supplierId)) || 0,
      platformCov,
      brandCov: parseFiniteNumber(brandCovByBrand.get(productBrandKey)) || 0
    });
    const latestPrice = bcovResolved?.price ?? basePrice;
    const latestStock = product.stock || 0;
    const latestDescription = product.description || '';
    const latestName = product.name || itemName;
    const latestUnit = product.unit || 'nos';
    const latestCategory = product.category || itemCategory;
    const latestLocation = product.location || '';
    const latestAttributes = product.attributes || {};
    const latestSpecifications = product.specifications || {};
    const supplierSpecificationsNestedCandidate =
      latestAttributes?.specifications || latestAttributes?.specs || latestAttributes?.specification || {};
    const supplierSpecificationsNested =
      supplierSpecificationsNestedCandidate &&
      typeof supplierSpecificationsNestedCandidate === 'object' &&
      !Array.isArray(supplierSpecificationsNestedCandidate)
        ? supplierSpecificationsNestedCandidate
        : {};
    const supplierSpecificationsLegacy = Object.entries(
      latestAttributes && typeof latestAttributes === 'object' && !Array.isArray(latestAttributes)
        ? latestAttributes
        : {}
    ).reduce((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || NON_SPEC_ATTRIBUTE_KEYS.has(normalizedKey)) return acc;
      if (value === null || value === undefined || typeof value === 'object') return acc;
      const cleanValue = String(value).trim();
      if (!cleanValue) return acc;
      acc[normalizedKey] = cleanValue;
      return acc;
    }, {});
    const mergedSpecifications = {
      ...(latestSpecifications && typeof latestSpecifications === 'object' && !Array.isArray(latestSpecifications)
        ? latestSpecifications
        : {}),
      ...supplierSpecificationsLegacy,
      ...supplierSpecificationsNested
    };
    const skuNo = firstNonEmpty(
      product.skuNo,
      latestSpecifications.skuNo,
      latestSpecifications.sku,
      latestSpecifications.SKU,
      latestSpecifications.gsku,
      latestSpecifications.GSKU
    );
    const modelBrand = firstNonEmpty(
      latestAttributes.brandModel,
      latestSpecifications.modelBrand,
      latestSpecifications.brandModel,
      latestSpecifications.brand
    );
    const productIdentification = buildProductIdentification({ skuNo, modelBrand });

    const locationCandidates = supplierLocationCandidates({
      productLocation: latestLocation,
      supplierAddress,
      supplierProfile: product?.supplier?.profile || {}
    });
    const supplierLocation = locationCandidates[0] || 'Location not specified';

    if (!supplierProducts[supplierId]) {
      supplierProducts[supplierId] = {
        supplierId,
        supplierName: product.supplier.name || product.supplier.company || 'Unknown Supplier',
        supplierCompany: product.supplier.company || '',
        supplierLocation,
        locationCandidates,
        products: [],
        bestPrice: latestPrice,
        bestRating: parseFloat(product.average_rating) || 0,
        totalStock: 0,
        hasApprovedProduct: product.status === 'approved' || product.sharedProductStatus === 'approved'
      };
    } else if (locationCandidates.length > 0) {
      const mergedCandidates = uniqueLocationList([
        ...(supplierProducts[supplierId].locationCandidates || []),
        ...locationCandidates
      ]);
      supplierProducts[supplierId].locationCandidates = mergedCandidates;
      if (
        (!supplierProducts[supplierId].supplierLocation ||
          supplierProducts[supplierId].supplierLocation === 'Location not specified') &&
        mergedCandidates[0]
      ) {
        supplierProducts[supplierId].supplierLocation = mergedCandidates[0];
      }
    }

    supplierProducts[supplierId].products.push({
      ...product,
      supplierProductId: product.supplierProductId || product.id || null,
      supplierVariantKey: product.supplierVariantKey || product.variant_key || null,
      supplierVariantAsin: product.supplierVariantAsin || product.variant_asin || null,
      basePrice,
      bcovApplied: !!bcovResolved,
      bcovLevelId: bcovResolved?.levelId || null,
      price: latestPrice,
      stock: latestStock,
      description: latestDescription,
      name: latestName,
      unit: latestUnit,
      category: latestCategory,
      skuNo: skuNo || null,
      modelBrand: modelBrand || null,
      productIdentification: productIdentification || null,
      specifications: mergedSpecifications
    });
    supplierProducts[supplierId].bestPrice = Math.min(supplierProducts[supplierId].bestPrice, latestPrice);
    supplierProducts[supplierId].bestRating = Math.max(
      supplierProducts[supplierId].bestRating,
      parseFloat(product.average_rating) || 0
    );
    supplierProducts[supplierId].totalStock += latestStock;
    if (product.status === 'approved' || product.sharedProductStatus === 'approved') {
      supplierProducts[supplierId].hasApprovedProduct = true;
    }
  }

  return supplierProducts;
}
