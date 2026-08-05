import {
  buildProductIdentification,
  firstNonEmpty,
  normalizeBrandKey,
  parseFiniteNumber,
  resolveBcovPriceForBuyerMetrics
} from './procurementSharedService.js';
import {
  resolveSupplierPincode,
  supplierLocationCandidates,
  uniqueLocationList
} from './vendorRankingHelpersService.js';
import {
  mergeOfferSpecifications,
  parseSpecificationsObject,
  parseSupplierOfferAttributes
} from './supplierCatalogHelpersService.js';

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
  const bcovBySupplierVariant = new Map();
  if (productSupplierIds.length > 0) {
    const { data: bcovRows, error: bcovError } = await supabase
      .from('supplier_bcov_levels')
      .select('id, supplier_id, variant_key, normalized_brand, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .in('supplier_id', productSupplierIds);
    if (bcovError) {
      console.error('[Vendor Ranking] BCOV preload error:', bcovError);
    } else {
      for (const row of bcovRows || []) {
        const key = `${row.supplier_id}::${row.variant_key || row.normalized_brand}`;
        if (!bcovBySupplierVariant.has(key)) bcovBySupplierVariant.set(key, []);
        bcovBySupplierVariant.get(key).push(row);
      }
      for (const [key, levels] of bcovBySupplierVariant.entries()) {
        levels.sort(
          (a, b) => (parseFiniteNumber(b.min_purchase_qty) || 0) - (parseFiniteNumber(a.min_purchase_qty) || 0)
        );
        bcovBySupplierVariant.set(key, levels);
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
    const productVariantKey = String(product?.variant_key || '').trim();
    const productBrandKey = normalizeBrandKey(
      product?.attributes?.brandModel ||
        product?.attributes?.brand ||
        product?.specifications?.brandModel ||
        product?.specifications?.brand ||
        product?.brand ||
        targetBrand
    );
    const bcovLevels =
      (productVariantKey && bcovBySupplierVariant.get(`${supplierId}::${productVariantKey}`)) ||
      bcovBySupplierVariant.get(`${supplierId}::${productBrandKey}`) ||
      [];
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
    const latestAttributes = parseSupplierOfferAttributes(product.attributes);
    const mergedSpecifications = product.offerSpecificationsMerged
      ? parseSpecificationsObject(product.specifications) || product.specifications || {}
      : mergeOfferSpecifications(
          product.catalogSpecifications || product.specifications,
          { attributes: latestAttributes },
          product.variantMeta || null
        );
    const skuNo = firstNonEmpty(
      product.skuNo,
      mergedSpecifications.skuNo,
      mergedSpecifications.sku,
      mergedSpecifications.SKU,
      mergedSpecifications.gsku,
      mergedSpecifications.GSKU
    );
    const modelBrand = firstNonEmpty(
      latestAttributes.brandModel,
      mergedSpecifications.modelBrand,
      mergedSpecifications.brandModel,
      mergedSpecifications.brand
    );
    const productIdentification = buildProductIdentification({ skuNo, modelBrand });

    const locationCandidates = supplierLocationCandidates({
      productLocation: latestLocation,
      supplierAddress,
      supplierProfile: product?.supplier?.profile || {}
    });
    const supplierLocation = locationCandidates[0] || 'Location not specified';
    const supplierPincode = resolveSupplierPincode({
      productLocation: latestLocation,
      supplierAddress,
      supplierProfile: product?.supplier?.profile || {}
    });

    if (!supplierProducts[supplierId]) {
      supplierProducts[supplierId] = {
        supplierId,
        supplierName: product.supplier.name || product.supplier.company || 'Unknown Supplier',
        supplierCompany: product.supplier.company || '',
        supplierLocation,
        supplierPincode,
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
    if (!supplierProducts[supplierId].supplierPincode && supplierPincode) {
      supplierProducts[supplierId].supplierPincode = supplierPincode;
    }

    const parentTsin = product.asin || product.parentAsin || null;
    const variantTsin = product.variant_asin || product.supplierVariantAsin || null;
    supplierProducts[supplierId].products.push({
      ...product,
      asin: parentTsin,
      parentAsin: parentTsin,
      supplierProductId: product.supplierProductId || product.id || null,
      supplierVariantKey: product.supplierVariantKey || product.variant_key || null,
      supplierVariantAsin: variantTsin,
      variantAsin: variantTsin,
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
