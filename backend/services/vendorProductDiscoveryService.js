import {
  buildVariantMetaByKey,
  mergeOfferSpecifications,
  parseSpecificationsObject,
  parseSupplierOfferAttributes,
  resolveOfferCatalogProductId
} from './supplierCatalogHelpersService.js';

function buildCatalogProductMeta(product = {}) {
  return {
    name: product.name,
    description: product.description,
    category: product.category,
    unit: product.unit,
    asin: product.asin || null,
    images: Array.isArray(product.images) ? product.images.filter(Boolean) : [],
    average_rating: product.average_rating,
    status: product.status,
    location: product.location,
    specifications: parseSpecificationsObject(product.specifications) || product.specifications || {}
  };
}

function resolveVariantMetaForOffer(row = {}, variantMetaByKey = new Map()) {
  const variantAsin = String(row?.variant_asin || '').trim();
  const variantKey = String(row?.variant_key || '').trim();
  if (variantAsin && variantMetaByKey.has(`asin:${variantAsin}`)) {
    return variantMetaByKey.get(`asin:${variantAsin}`);
  }
  if (variantKey && variantMetaByKey.has(variantKey)) {
    return variantMetaByKey.get(variantKey);
  }
  return null;
}

async function loadVariantMetaByKeyForOffers(supabase, { familyId = null, offerRows = [] } = {}) {
  const variantMetaByKey = new Map();

  const mergeRows = (rows = []) => {
    for (const [key, row] of buildVariantMetaByKey(rows)) {
      variantMetaByKey.set(key, row);
    }
  };

  if (familyId) {
    const { data: familyVariantRows, error: familyVariantError } = await supabase
      .from('product_variants')
      .select('product_id, variant_key, variant_asin, canonical_attributes')
      .eq('family_id', familyId);
    if (familyVariantError) {
      console.error('[Vendor Ranking] Family variant preload failed:', familyVariantError);
    } else {
      mergeRows(familyVariantRows || []);
    }
  }

  const variantAsins = [
    ...new Set((offerRows || []).map((row) => String(row?.variant_asin || '').trim()).filter(Boolean))
  ];
  if (variantAsins.length > 0) {
    const { data: asinVariantRows, error: asinVariantError } = await supabase
      .from('product_variants')
      .select('product_id, variant_key, variant_asin, canonical_attributes')
      .in('variant_asin', variantAsins);
    if (asinVariantError) {
      console.error('[Vendor Ranking] Variant-asin preload failed:', asinVariantError);
    } else {
      mergeRows(asinVariantRows || []);
    }
  }

  const variantKeys = [
    ...new Set((offerRows || []).map((row) => String(row?.variant_key || '').trim()).filter(Boolean))
  ].filter((key) => !variantMetaByKey.has(key));
  if (variantKeys.length > 0) {
    const { data: keyVariantRows, error: keyVariantError } = await supabase
      .from('product_variants')
      .select('product_id, variant_key, variant_asin, canonical_attributes')
      .in('variant_key', variantKeys);
    if (keyVariantError) {
      console.error('[Vendor Ranking] Variant-key preload failed:', keyVariantError);
    } else {
      mergeRows(keyVariantRows || []);
    }
  }

  return variantMetaByKey;
}

export async function searchRankableProductsForItem({
  supabase,
  item,
  itemId,
  itemName,
  itemNameLower,
  itemCategory,
  referenceProduct,
  buildNameSearchPatterns,
  fuzzyNameCompatible
}) {
  let products = [];

  const searchPatterns = buildNameSearchPatterns(itemNameLower);
  let query = supabase
    .from('products')
    .select(`
      *,
      supplier:users!products_supplier_id_fkey (id, name, company, email, phone, address, profile)
    `)
    .in('status', ['approved', 'pending'])
    .or(
      searchPatterns.length > 0
        ? searchPatterns.map((pattern) => `name.ilike.${pattern},description.ilike.${pattern}`).join(',')
        : `name.ilike.%${itemNameLower}%,description.ilike.%${itemNameLower}%`
    );

  if (itemCategory !== 'other') {
    query = query.eq('category', itemCategory);
  }

  query = query.order('price', { ascending: true }).order('average_rating', { ascending: false }).limit(100);
  const { data: productsByName, error: errorByName } = await query;
  products = productsByName || [];

  if (errorByName) {
    console.error(`[Vendor Ranking] Products query error for "${itemName}":`, errorByName);
    products = [];
  } else {
    console.log(`[Vendor Ranking] Found ${products?.length || 0} products for "${itemName}"`);
  }

  if (!item.productId && Array.isArray(products) && products.length > 0) {
    const before = products.length;
    products = products.filter((p) => fuzzyNameCompatible(itemName, p?.name));
    if (before !== products.length) {
      console.log(`[Vendor Ranking] Fuzzy guard for item ${itemId}: kept ${products.length}/${before} name-compatible products`);
    }
  }

  if (item.productId && products && products.length > 0) {
    const exactMatchIndex = products.findIndex((p) => p.id === item.productId);
    if (exactMatchIndex > 0) {
      const exactMatch = products.splice(exactMatchIndex, 1)[0];
      products.unshift(exactMatch);
    } else if (exactMatchIndex === -1 && referenceProduct) {
      products.unshift(referenceProduct);
    }
  } else if (item.productId && referenceProduct && (!products || products.length === 0)) {
    console.log(`[Vendor Ranking] No products found in search, using reference product: ${referenceProduct.name}`);
    products = [referenceProduct];
  }

  if ((!products || products.length === 0) && itemCategory !== 'other') {
    console.log(`[Vendor Ranking] No products found, trying category search: ${itemCategory}`);
    const { data: categoryProducts } = await supabase
      .from('products')
      .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, company, email, phone, address, profile)
      `)
      .eq('category', itemCategory)
      .in('status', ['approved', 'pending'])
      .order('price', { ascending: true })
      .order('average_rating', { ascending: false })
      .limit(50);

    products = categoryProducts || [];
    if ((!products || products.length === 0) && referenceProduct) {
      console.log(`[Vendor Ranking] No category products found, using reference product: ${referenceProduct.name}`);
      products = [referenceProduct];
    }
  } else if ((!products || products.length === 0) && referenceProduct) {
    console.log(`[Vendor Ranking] No products found in any search, using reference product: ${referenceProduct.name}`);
    products = [referenceProduct];
  }

  return products;
}

export async function reconcileWithSupplierOffers({
  supabase,
  products,
  item,
  itemId,
  itemName,
  referenceProduct,
  includeAllVariants = false,
  targetBrand,
  detectProductBrandKey,
  fuzzyNameCompatible,
  hasModelTokenConflict
}) {
  let updatedProducts = products;
  try {
    const baseCandidateProductIds = item.productId
      ? [
          ...new Set(
            (updatedProducts || [])
              .filter((p) => {
                if (!p?.id) return false;
                if (p.id === item.productId) return true;
                const productBrand = detectProductBrandKey(p);
                if (targetBrand && productBrand && productBrand !== targetBrand) return false;
                if (!fuzzyNameCompatible(itemName, p.name)) return false;
                if (hasModelTokenConflict(itemName, p.name)) return false;
                return true;
              })
              .map((p) => p.id)
          )
        ]
      : [...new Set((updatedProducts || []).map((p) => p?.id).filter(Boolean))];
    const candidateProductIds = [...baseCandidateProductIds];
    if (includeAllVariants && referenceProduct?.family_id) {
      const { data: familyProducts, error: familyProductsError } = await supabase
        .from('products')
        .select('id')
        .eq('family_id', referenceProduct.family_id)
        .in('status', ['approved', 'pending']);
      if (familyProductsError) {
        console.error(`[Vendor Ranking] Family variant lookup failed for item ${itemId}:`, familyProductsError);
      } else {
        for (const row of familyProducts || []) {
          if (row?.id && !candidateProductIds.includes(row.id)) {
            candidateProductIds.push(row.id);
          }
        }
      }
    }

    if (candidateProductIds.length > 0) {
      const productMetaById = {};
      for (const p of updatedProducts || []) {
        if (!p?.id) continue;
        productMetaById[p.id] = buildCatalogProductMeta(p);
      }

      const { data: catalogProducts, error: catalogProductsError } = await supabase
        .from('products')
        .select(
          'id, name, description, category, unit, asin, images, average_rating, status, location, specifications, family_id'
        )
        .in('id', candidateProductIds);
      if (catalogProductsError) {
        console.error(
          `[Vendor Ranking] Catalog preload failed for item ${itemId}:`,
          catalogProductsError
        );
      } else {
        for (const product of catalogProducts || []) {
          if (!product?.id) continue;
          productMetaById[product.id] = buildCatalogProductMeta(product);
        }
      }

      const { data: offerRows, error: offerRowsError } = await supabase
        .from('supplier_products')
        .select(`
          id,
          product_id,
          price,
          stock,
          min_order_quantity,
          location,
          outlet_id,
          variant_key,
          variant_asin,
          attributes,
          status,
          is_active,
          supplier:users!supplier_products_supplier_id_fkey
            (id, name, company, email, phone, address, profile)
        `)
        .in('product_id', candidateProductIds)
        .in('status', ['approved', 'pending']);

      const variantMetaByKey = await loadVariantMetaByKeyForOffers(supabase, {
        familyId: referenceProduct?.family_id || null,
        offerRows: offerRowsError ? [] : offerRows || []
      });

      if (!offerRowsError && Array.isArray(offerRows) && offerRows.length > 0) {
        console.log(
          `[Vendor Ranking] supplier_products offers sample for item ${itemId}:`,
          offerRows.slice(0, 5).map((r) => ({
            product_id: r.product_id,
            supplier_id: r.supplier_id,
            price: r.price,
            stock: r.stock,
            status: r.status,
            is_active: r.is_active
          }))
        );

        updatedProducts = offerRows
          .map((row) => {
            const supplier = row?.supplier;
            if (!supplier?.id) return null;
            const parsedAttributes = parseSupplierOfferAttributes(row.attributes);
            const variantMeta = resolveVariantMetaForOffer(row, variantMetaByKey);
            const catalogProductId = resolveOfferCatalogProductId(row, variantMetaByKey);
            const meta = productMetaById[catalogProductId] || productMetaById[row.product_id] || {};
            const catalogSpecifications = meta.specifications || {};
            const displaySpecifications = mergeOfferSpecifications(
              catalogSpecifications,
              { attributes: parsedAttributes },
              variantMeta
            );
            return {
              ...meta,
              // Prefer product_variants-linked catalog id so ranking scores the resolved sibling.
              id: catalogProductId || row.product_id,
              offerProductId: row.product_id,
              name: meta.name,
              description: meta.description,
              category: meta.category,
              unit: meta.unit || 'nos',
              catalogSpecifications,
              specifications: displaySpecifications,
              offerSpecificationsMerged: true,
              variantMeta,
              images:
                Array.isArray(parsedAttributes?.images) && parsedAttributes.images.length > 0
                  ? parsedAttributes.images.filter(Boolean)
                  : (Array.isArray(meta.images) ? meta.images : []),
              productImage:
                Array.isArray(parsedAttributes?.images) && parsedAttributes.images.length > 0
                  ? parsedAttributes.images.find(Boolean) || null
                  : (Array.isArray(meta.images) ? meta.images.find(Boolean) || null : null),
              attributes: parsedAttributes,
              supplierProductId: row.id || null,
              asin: meta.asin || null,
              variant_key: row.variant_key || null,
              variant_asin: row.variant_asin || null,
              supplier,
              supplier_id: supplier.id,
              price: Number.isFinite(parseFloat(row.price)) ? parseFloat(row.price) : 0,
              stock: Number.isFinite(parseInt(row.stock, 10)) ? parseInt(row.stock, 10) : 0,
              // Never fall back to the shared catalog product's `location` (`meta.location`) here:
              // that field belongs to whichever supplier originally created this catalog listing,
              // which can be a COMPLETELY DIFFERENT supplier than the one on this offer row. Doing
              // so previously made every supplier who left their own offer location blank silently
              // "inherit" the catalog creator's address/city — e.g. a Pune-based seller showing up
              // as if they ship from the catalog creator's Bengaluru address, with a matching (and
              // very wrong) short "distance from your project site". Leave it blank instead, so
              // downstream ranking falls back to THIS supplier's own registered account/branch
              // address (see vendorRankingHelpersService.supplierLocationCandidates).
              location: (row.location || '').toString(),
              outlet_id: row.outlet_id || null,
              status: row.status,
              sharedProductStatus: meta.status || null,
              is_active: row.is_active
            };
          })
          .filter(Boolean);

        console.log(
          `[Vendor Ranking] Reconciled products using supplier_products for item ${itemId}: ${updatedProducts.length} offers`
        );
      } else {
        console.log(
          `[Vendor Ranking] No supplier_products offers found for candidate product ids; keeping legacy products. item ${itemId}`
        );
      }
    }
  } catch (e) {
    console.error('[Vendor Ranking] supplier_products reconciliation failed:', e?.message || e);
  }

  return updatedProducts;
}
