/** Admin product catalog routes (list, get, update). */
import { adminUpdateProductSchema } from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import {
  normalizeModelIdentifier,
  sanitizeSpecifications,
  mergeAdminEditedSpecificationsOntoOffer,
  parseSpecificationsObject,
  isMeaningfullyFilledSpecValue
} from '../../services/supplierCatalogHelpersService.js';
import { syncOfferAttributesWithSpecifications } from '../../services/productIdentityService.js';
import { buildProductIdentification, firstNonEmpty } from '../../services/procurementSharedService.js';
import { syncCatalogProductSnapshotFromOffers } from '../../services/catalogOfferSnapshotService.js';
import { buildAdminPublishedDescriptionAttributes } from '../../utils/supplierProductDescriptions.js';
import { propagateVariantMrpToAllOffers } from '../../services/variantMrpService.js';
import { catalogListingIdentityConflicts } from '../../utils/catalogProductAttach.js';
import { resolveSupplierOfferDisplayName, resolveSupplierOfferDisplayCategory } from '../../services/supplierProductWriteService.js';

function scoreSupplierOfferRow(row) {
  const rowStatus = row.status;
  const rowIsActive = row.is_active === true;
  const stock = Number.isFinite(parseInt(row.stock, 10)) ? parseInt(row.stock, 10) : 0;
  const price = Number.isFinite(parseFloat(row.price)) ? parseFloat(row.price) : 0;
  const score =
    rowStatus === 'approved' && rowIsActive ? 2 :
    rowStatus === 'approved' ? 1 : 0;
  return { row, _score: score, _stock: stock, _price: price };
}

/** Pending/rejected review uses the submitting supplier's offer, not another approved listing. */
export function pickSupplierOfferRowForAdmin(rows = [], { catalogStatus = '', primarySupplierId = null, preferPending = false } = {}) {
  if (!rows.length) return null;

  if (preferPending) {
    const pendingRows = rows.filter((row) => String(row?.status || '').toLowerCase() === 'pending');
    if (pendingRows.length > 0) {
      return pendingRows
        .slice()
        .sort((a, b) => new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime())[0];
    }
  }

  const normalizedStatus = String(catalogStatus || '').toLowerCase();
  if (normalizedStatus !== 'approved' && primarySupplierId) {
    const primaryRow = rows.find((row) => row.supplier_id === primarySupplierId);
    if (primaryRow) return primaryRow;
  }
  return rows
    .map(scoreSupplierOfferRow)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      if (b._stock !== a._stock) return b._stock - a._stock;
      return a._price - b._price;
    })[0]?.row ?? null;
}

function attachSupplierOfferFields(product, offerRow, { hasSupplierOffer = true, hasPendingSupplierOffer = false } = {}) {
  if (!offerRow) {
    return { ...product, hasSupplierOffer, hasPendingSupplierOffer };
  }
  const catalogSpecs = parseSpecificationsObject(product.specifications) || {};
  const offerSpecs = parseSpecificationsObject(offerRow?.attributes?.specifications) || {};
  const catalogApproved = String(product.status || '').toLowerCase() === 'approved';
  const offerPending = String(offerRow?.status || '').toLowerCase() === 'pending';
  const listingName = resolveSupplierOfferDisplayName({
    attributes: offerRow?.attributes || {},
    catalogName: product.name
  });
  const listingCategory = resolveSupplierOfferDisplayCategory({
    attributes: offerRow?.attributes || {},
    catalogCategory: product.category
  });
  const offerBrand = String(
    offerRow?.attributes?.brand || offerRow?.attributes?.brandModel || ''
  ).trim();
  const offerUnit = String(offerRow?.attributes?.unit || '').trim();
  const offerGtin = String(offerRow?.attributes?.gtin || '').trim();
  const offerImages = Array.isArray(offerRow?.attributes?.images) ? offerRow.attributes.images : null;

  return {
    ...product,
    name: listingName || product.name,
    category: listingCategory || product.category || '',
    brand: offerBrand || product.brand || '',
    unit: offerUnit || product.unit || '',
    gtin: offerGtin || product.gtin || '',
    images:
      offerImages && offerImages.length > 0 ? offerImages : product.images,
    catalogName: product.name,
    catalogBrand: product.brand || '',
    catalogCategory: product.category || '',
    hasSupplierOffer,
    hasPendingSupplierOffer,
    adminReviewPending: hasPendingSupplierOffer || String(product.status || 'pending').toLowerCase() === 'pending',
    pendingReviewType:
      catalogApproved && offerPending ? 'variant_spec' : 'catalog',
    supplier_product_id: offerRow.id,
    supplierProductId: offerRow.id,
    price: offerRow.price,
    stock: offerRow.stock,
    min_order_quantity: offerRow.min_order_quantity ?? product.min_order_quantity,
    location: offerRow.location ?? product.location,
    lsa:
      offerRow?.attributes?.lsa != null && String(offerRow.attributes.lsa).trim() !== ''
        ? String(offerRow.attributes.lsa).trim()
        : product?.lsa != null && String(product.lsa).trim() !== ''
          ? String(product.lsa).trim()
          : product?.attributes?.lsa != null
            ? String(product.attributes.lsa).trim()
            : '',
    supplier_id: product.supplier_id || offerRow.supplier_id || null,
    igst_rate: offerRow.igst_rate ?? offerRow?.attributes?.igstRate ?? product.igst_rate ?? null,
    cgst_rate: offerRow.cgst_rate ?? offerRow?.attributes?.cgstRate ?? product.cgst_rate ?? null,
    sgst_rate: offerRow.sgst_rate ?? offerRow?.attributes?.sgstRate ?? product.sgst_rate ?? null,
    hsnCode: offerRow?.attributes?.hsnCode ?? product.hsnCode ?? product.hsn_code ?? null,
    brandModel: offerRow?.attributes?.brandModel ?? product.brandModel ?? null,
    catalogSpecifications: catalogSpecs,
    supplierOfferSpecifications: offerSpecs,
    specifications: offerSpecs,
    offerStatus: offerRow.status || null,
    variantKey: offerRow.variant_key || null,
    variantAsin: offerRow.variant_asin || null,
    publishedDescription:
      offerRow?.attributes?.publishedDescription ||
      '',
    supplierDescription:
      offerRow?.attributes?.supplierDescription ||
      offerRow?.attributes?.description ||
      ''
  };
}

export function shouldPreserveSharedCatalogIdentity(catalogProduct, offerRow) {
  if (!catalogProduct || !offerRow) return false;
  const attrs =
    offerRow.attributes && typeof offerRow.attributes === 'object' ? offerRow.attributes : {};
  return catalogListingIdentityConflicts({
    catalogName: catalogProduct.name,
    catalogCategory: catalogProduct.category,
    listingName: attrs.listingName || attrs.name,
    listingCategory: attrs.category
  });
}

const SHARED_CATALOG_IDENTITY_KEYS = [
  'name',
  'category',
  'brand',
  'description',
  'specifications',
  'images',
  'gtin',
  'mpn',
  'barcode'
];

/** Resolve which supplier_products row admin inventory edits should target. */
export function resolveAdminTargetOfferRow(rows = [], { validatedBody = {}, catalogStatus = '', primarySupplierId = null } = {}) {
  const explicitId = String(
    validatedBody?.supplier_product_id || validatedBody?.supplierProductId || ''
  ).trim();
  if (explicitId) {
    const explicitRow = rows.find((row) => String(row?.id || '') === explicitId);
    if (explicitRow) return explicitRow;
  }
  return pickSupplierOfferRowForAdmin(rows, { catalogStatus, primarySupplierId });
}

async function reconcileAdminProductWithOffers(supabase, product) {
  if (!product?.id) return product;
  const { data: spRows, error } = await supabase
    .from('supplier_products')
    .select('id, product_id, price, stock, min_order_quantity, location, status, is_active, supplier_id, attributes, igst_rate, cgst_rate, sgst_rate')
    .eq('product_id', product.id);
  if (error || !spRows?.length) {
    return { ...product, hasSupplierOffer: Boolean(product.hasSupplierOffer) };
  }
  const best = pickSupplierOfferRowForAdmin(spRows, {
    catalogStatus: product.status,
    primarySupplierId: product.supplier_id
  });
  return attachSupplierOfferFields(product, best, { hasSupplierOffer: true });
}

const VARIANT_LABEL_SKIP_KEYS = new Set([
  'brand',
  'brandmodel',
  'gtin',
  'upc',
  'ean',
  'sku',
  'gsku',
  'skuno',
  'mpn',
  'packsize',
  'pack_size'
]);

function buildAdminVariantLabel(offerSpecs = {}) {
  const parts = Object.entries(offerSpecs || {})
    .filter(([key, value]) => {
      const normalized = String(key || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      if (!normalized || VARIANT_LABEL_SKIP_KEYS.has(normalized)) return false;
      return isMeaningfullyFilledSpecValue(value);
    })
    .slice(0, 3)
    .map(([key, value]) => `${String(key).trim()}: ${String(value).trim()}`);
  return parts.join(' · ');
}

/** Expand one catalog product into one admin row per supplier offer variant. */
export function expandCatalogProductIntoAdminReviewRows(
  product,
  offerRows = [],
  suppliersById = {}
) {
  if (!offerRows.length) {
    return [
      {
        ...attachSupplierOfferFields(product, null, { hasSupplierOffer: false }),
        adminRowKey: `${product.id}:catalog`,
        catalogProductId: product.id,
        displayStatus: String(product.status || 'pending').toLowerCase(),
        isVariantRow: false
      }
    ];
  }

  return offerRows
    .slice()
    .sort(
      (a, b) =>
        new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime()
    )
    .map((offerRow) => {
      const offerSpecs = parseSpecificationsObject(offerRow?.attributes?.specifications) || {};
      const offerPending = String(offerRow?.status || '').toLowerCase() === 'pending';
      const attached = attachSupplierOfferFields(product, offerRow, {
        hasSupplierOffer: true,
        hasPendingSupplierOffer: offerPending
      });
      const variantLabel = buildAdminVariantLabel(offerSpecs);
      const offerSupplier = suppliersById[offerRow.supplier_id] || product.supplier || null;

      return {
        ...attached,
        adminRowKey: `${product.id}:${offerRow.id}`,
        catalogProductId: product.id,
        displayStatus: String(offerRow.status || product.status || 'pending').toLowerCase(),
        isVariantRow: true,
        variantLabel,
        catalogName: product.name,
        catalogBrand: product.brand || '',
        catalogCategory: product.category || '',
        supplier: offerSupplier,
        supplier_id: offerRow.supplier_id || product.supplier_id || null
      };
    });
}

export function registerAdminProductCatalogRoutes({ router, authenticateToken, isAdmin, supabase, console }) {
router.get('/products/all', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    
    console.log('🔍 Querying products from Supabase...');
    
    // Get ALL products - try inferred relationship first
    let { data: allProducts, error: queryError } = await supabase
      .from('products')
      .select(`
        *,
        supplier:users(id, name, email, company)
      `)
      .order('created_at', { ascending: false });
    
    // If that fails, try with explicit constraint name
    if (queryError || !allProducts) {
      console.log('Trying alternative join syntax for products...');
      const { data: productsAlt, error: productsAltError } = await supabase
        .from('products')
        .select(`
          *,
          supplier:users!products_supplier_id_fkey (id, name, email, company)
        `)
        .order('created_at', { ascending: false });
      
      if (!productsAltError && productsAlt) {
        allProducts = productsAlt;
        queryError = null;
      } else {
        console.error('Products query error:', productsAltError || queryError);
      }
    }
    
    // If joins still fail, fetch products without join first, then join suppliers manually
    if (queryError || !allProducts) {
      console.log('Fetching products without supplier join...');
      const { data: productsOnly, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!productsError && productsOnly) {
        allProducts = productsOnly;
        queryError = null;
        console.log(`Fetched ${allProducts.length} products without supplier join`);
      }
    }
    
    // If we have products but no supplier data, join suppliers manually
    if (allProducts && allProducts.length > 0 && (!allProducts[0].supplier || allProducts.some(p => !p.supplier && p.supplier_id))) {
      console.log('Joining suppliers manually for products...');
      const supplierIds = [...new Set(allProducts.map(p => p.supplier_id).filter(Boolean))];
      
      if (supplierIds.length > 0) {
        const { data: suppliers } = await supabase
          .from('users')
          .select('id, name, email, company')
          .in('id', supplierIds);
        
        if (suppliers) {
          const suppliersMap = {};
          suppliers.forEach(s => { suppliersMap[s.id] = s; });
          
          allProducts = allProducts.map(product => ({
            ...product,
            supplier: product.supplier_id ? suppliersMap[product.supplier_id] : null
          }));
          console.log(`Joined ${suppliers.length} suppliers to products`);
        }
      }
    }

    let productIdsWithSupplierOffers = new Set();
    let productIdsWithPendingOffers = new Set();

    // Always reconcile price/stock from supplier_products.
    // Supplier portal updates inventory in `supplier_products`, but this admin page
    // previously relied on legacy `products.price/stock`, which can stay 0.
    if (allProducts && allProducts.length > 0) {
      const productIds = [...new Set((allProducts || []).map((p) => p.id).filter(Boolean))];

      if (productIds.length > 0) {
        const { data: spRows, error: spRowsError } = await supabase
          .from('supplier_products')
          .select('id, product_id, price, stock, min_order_quantity, location, status, is_active, supplier_id, attributes, igst_rate, cgst_rate, sgst_rate, updated_at, variant_key, variant_asin')
          .in('product_id', productIds);

        if (!spRowsError && spRows) {
          productIdsWithSupplierOffers = new Set(
            spRows.map((row) => row.product_id).filter(Boolean)
          );
          productIdsWithPendingOffers = new Set(
            spRows
              .filter((row) => String(row?.status || '').toLowerCase() === 'pending')
              .map((row) => row.product_id)
              .filter(Boolean)
          );
          const rowsByProductId = new Map();
          for (const row of spRows) {
            if (!row?.product_id) continue;
            if (!rowsByProductId.has(row.product_id)) rowsByProductId.set(row.product_id, []);
            rowsByProductId.get(row.product_id).push(row);
          }

          const offerSupplierIds = [
            ...new Set(spRows.map((row) => row.supplier_id).filter(Boolean))
          ];
          const suppliersById = {};
          if (offerSupplierIds.length > 0) {
            const { data: offerSuppliers } = await supabase
              .from('users')
              .select('id, name, email, company')
              .in('id', offerSupplierIds);
            (offerSuppliers || []).forEach((supplier) => {
              suppliersById[supplier.id] = supplier;
            });
          }

          allProducts = (allProducts || []).flatMap((p) => {
            const productRows = rowsByProductId.get(p.id) || [];
            if (productRows.length === 0) return [p];
            return expandCatalogProductIntoAdminReviewRows(p, productRows, suppliersById);
          });
        } else {
          console.error('Admin products price/stock reconcile error:', spRowsError);
        }
      }
    }

    // Final fallback: products can exist without `products.supplier_id` (legacy/shared),
    // but `supplier_products` still contains the real supplier who offered the product.
    // Admin UI expects to always show a supplier name.
    const productsMissingSupplier = (allProducts || []).filter(
      (p) => (!p.supplier || !p.supplier.id) && !p.supplier_id
    );
    if (productsMissingSupplier.length > 0) {
      const missingProductIds = [...new Set(productsMissingSupplier.map(p => p.id))];
      const { data: spRows, error: spRowsError } = await supabase
        .from('supplier_products')
        .select(`
          product_id,
          supplier:users!supplier_products_supplier_id_fkey (id, name, email, company),
          status,
          is_active
        `)
        .in('product_id', missingProductIds);

      if (!spRowsError && spRows) {
        const bestByProduct = new Map();
        for (const row of spRows) {
          if (!row?.supplier?.id) continue;
          const productId = row.product_id;

          const rowScore =
            row.status === 'approved' && row.is_active === true
              ? 2
              : row.status === 'approved'
                ? 1
                : 0;

          const existing = bestByProduct.get(productId);
          const existingScore =
            existing?.status === 'approved' && existing?.is_active === true
              ? 2
              : existing?.status === 'approved'
                ? 1
                : 0;

          if (!existing || rowScore > existingScore) {
            bestByProduct.set(productId, row);
          }
        }

        allProducts = allProducts.map((p) => {
          if (p.supplier?.id) return p;
          const best = bestByProduct.get(p.id);
          return {
            ...p,
            supplier_id: p.supplier_id || best?.supplier?.id || null,
            supplier: best?.supplier || null,
          };
        });

        console.log(`Backfilled suppliers from supplier_products for ${missingProductIds.length} products`);
      } else {
        console.error('Backfill suppliers error:', spRowsError);
      }
    }
    
    // Only throw error if we have no products at all
    if (queryError && (!allProducts || allProducts.length === 0)) {
      console.error('Failed to fetch products:', queryError);
      throw queryError;
    }
    
    console.log(`Found ${(allProducts || []).length} total products in database`);
    
    // Log sample products for debugging
    if (allProducts && allProducts.length > 0) {
      console.log('Sample products:', allProducts.slice(0, 3).map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        supplier: p.supplier?.name || 'No supplier',
        supplier_id: p.supplier_id
      })));
    } else {
      console.log('No products found in database!');
    }

    // Build one trackable identifier for each product:
    // skuNo+modelBrand
    allProducts = (allProducts || []).map((p) => {
      const specs = p?.specifications || {};
      const skuNo = firstNonEmpty(
        p?.skuNo,
        p?.sku_no,
        specs?.skuNo,
        specs?.sku_no,
        specs?.sku,
        specs?.SKU,
        specs?.gsku,
        specs?.GSKU
      );
      const modelBrand = firstNonEmpty(p?.brandModel, p?.brand_model, specs?.brandModel, specs?.brand_model, specs?.brand, specs?.modelBrand);
      const productIdentification = buildProductIdentification({ skuNo, modelBrand });

      return {
        ...p,
        skuNo: skuNo || null,
        modelBrand: modelBrand || null,
        productIdentification: productIdentification || null
      };
    });
    
    // Filter by status in JavaScript — each supplier offer variant is its own admin row.
    let products = allProducts || [];
    if (status && status !== 'all') {
      if (status === 'pending') {
        products = (allProducts || []).filter((row) => {
          const offerStatus = String(row.displayStatus || row.offerStatus || '').toLowerCase();
          const catalogStatus = String(row.status || '').toLowerCase();
          const isPendingCatalog =
            !catalogStatus ||
            catalogStatus === 'pending' ||
            catalogStatus === '' ||
            (catalogStatus !== 'approved' && catalogStatus !== 'rejected');
          if (offerStatus === 'pending') return true;
          return isPendingCatalog && row.hasSupplierOffer !== false;
        });
        console.log(`Filtered to ${products.length} pending admin review rows`);
      } else if (status === 'approved') {
        products = (allProducts || []).filter((row) => {
          const offerStatus = String(row.displayStatus || row.offerStatus || '').toLowerCase();
          const catalogStatus = String(row.status || '').toLowerCase();
          if (row.isVariantRow === false && !row.offerStatus) {
            return catalogStatus === 'approved';
          }
          return offerStatus === 'approved' && catalogStatus === 'approved';
        });
        console.log(`Filtered to ${products.length} approved variant rows`);
      } else if (status === 'rejected') {
        products = (allProducts || []).filter((row) => {
          const offerStatus = String(row.displayStatus || row.offerStatus || '').toLowerCase();
          const catalogStatus = String(row.status || '').toLowerCase();
          if (offerStatus === 'rejected') return true;
          return catalogStatus === 'rejected' && row.hasSupplierOffer !== true;
        });
        console.log(`Filtered to ${products.length} rejected admin review rows`);
      }
    }
    
    // Log product statuses for debugging
    if (allProducts && allProducts.length > 0) {
      const statusCounts = {};
      allProducts.forEach(p => {
        const s = p.status || 'null/undefined';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      console.log('Product status breakdown:', statusCounts);
    }
    
    res.json({ 
      status: 'success',
      products: products || [],
      count: products ? products.length : 0,
      totalInDatabase: (allProducts || []).length,
      database: 'Supabase (PostgreSQL)'
    });
  } catch (error) {
    console.error('Get all products error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Return empty array on error so page doesn't break
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message,
      products: [],
      count: 0,
      database: 'Supabase (PostgreSQL)'
    });
  }
});

// Get single product by ID (admin only)
router.get('/products/:id([0-9a-fA-F-]{36})', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { data: productRow, error } = await supabase
      .from('products')
      .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, email, company)
      `)
      .eq('id', req.params.id)
      .single();
    
    if (error || !productRow) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found' 
      });
    }

    let product = productRow;

    // Reconcile price/stock from supplier_products so admin sees latest supplier inventory.
    const { data: spRows, error: spRowsError } = await supabase
      .from('supplier_products')
      .select('id, product_id, price, stock, min_order_quantity, location, status, is_active, supplier_id, attributes, igst_rate, cgst_rate, sgst_rate')
      .eq('product_id', product.id);

    if (!spRowsError && spRows && spRows.length > 0) {
      const bestRowByScore = pickSupplierOfferRowForAdmin(spRows, {
        catalogStatus: product.status,
        primarySupplierId: product.supplier_id
      });

      if (bestRowByScore) {
        product = attachSupplierOfferFields(product, bestRowByScore);
      }
    }

    const specs = product?.specifications || {};
    const skuNo = firstNonEmpty(
      product?.skuNo,
      product?.sku_no,
      specs?.skuNo,
      specs?.sku_no,
      specs?.sku,
      specs?.SKU,
      specs?.gsku,
      specs?.GSKU
    );
    const modelBrand = firstNonEmpty(product?.brandModel, product?.brand_model, specs?.brandModel, specs?.brand_model, specs?.brand, specs?.modelBrand);
    const productIdentification = buildProductIdentification({ skuNo, modelBrand });
    product.skuNo = skuNo || null;
    product.modelBrand = modelBrand || null;
    product.productIdentification = productIdentification || null;
    
    res.json({ 
      status: 'success',
      product,
      supplier: product.supplier
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.put('/products/:id([0-9a-fA-F-]{36})', authenticateToken, isAdmin, async (req, res) => {
  try {
    const validatedBody = parseWithSchema(adminUpdateProductSchema, req.body || {});
    console.log('[ADMIN UPDATE] Received update request for product:', req.params.id);
    console.log('[ADMIN UPDATE] Request body keys:', Object.keys(validatedBody));
    console.log('[ADMIN UPDATE] Request body category:', validatedBody.category);
    console.log('[ADMIN UPDATE] Request body specifications:', validatedBody.specifications);
    console.log('[ADMIN UPDATE] Request body specs keys count:', validatedBody.specifications ? Object.keys(validatedBody.specifications).length : 0);
    
    // Preserve specifications, including null values (null represents keys that need values)
    const updateData = { ...validatedBody };
    
    // Extract GST/tax fields - these belong to supplier_products, not products.
    const parseTax = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const allowedIgst = new Set([0, 5, 12, 18, 28]);
    const allowedCgstSgst = new Set([0, 2.5, 6, 9, 14]);

    const rawIgst = updateData.igst_rate ?? updateData.igstRate;
    const rawCgst = updateData.cgst_rate ?? updateData.cgstRate;
    const rawSgst = updateData.sgst_rate ?? updateData.sgstRate;
    const rawHsnCode = updateData.hsnCode ?? updateData.hsn_code;
    const requestedHsnUpdate = rawHsnCode !== undefined;
    const normalizedHsnCode = rawHsnCode === null || rawHsnCode === undefined
      ? ''
      : String(rawHsnCode).trim();
    if (requestedHsnUpdate && normalizedHsnCode !== '' && !/^\d{4,8}$/.test(normalizedHsnCode)) {
      return res.status(400).json({
        status: 'error',
        message: 'HSN code must be 4 to 8 digits.'
      });
    }
    const requestedTaxUpdate =
      rawIgst !== undefined || rawCgst !== undefined || rawSgst !== undefined;

    const normalizedTax = {
      igst_rate: parseTax(rawIgst),
      cgst_rate: parseTax(rawCgst),
      sgst_rate: parseTax(rawSgst)
    };

    if (requestedTaxUpdate) {
      const hasAllTaxValues =
        normalizedTax.igst_rate !== null &&
        normalizedTax.cgst_rate !== null &&
        normalizedTax.sgst_rate !== null;
      const hasAnyTaxValue =
        normalizedTax.igst_rate !== null ||
        normalizedTax.cgst_rate !== null ||
        normalizedTax.sgst_rate !== null;

      if (hasAnyTaxValue && !hasAllTaxValues) {
        return res.status(400).json({
          status: 'error',
          message: 'Please provide IGST, CGST, and SGST together.'
        });
      }

      if (hasAllTaxValues) {
        if (!allowedIgst.has(normalizedTax.igst_rate)) {
          return res.status(400).json({ status: 'error', message: 'Invalid IGST rate.' });
        }
        if (!allowedCgstSgst.has(normalizedTax.cgst_rate) || !allowedCgstSgst.has(normalizedTax.sgst_rate)) {
          return res.status(400).json({ status: 'error', message: 'Invalid CGST/SGST rate.' });
        }
        if (normalizedTax.cgst_rate !== normalizedTax.sgst_rate) {
          return res.status(400).json({ status: 'error', message: 'CGST and SGST must be equal.' });
        }
        if (Number((normalizedTax.cgst_rate + normalizedTax.sgst_rate).toFixed(2)) !== Number(normalizedTax.igst_rate.toFixed(2))) {
          return res.status(400).json({ status: 'error', message: 'IGST must equal CGST + SGST.' });
        }
      }
    }

    // Ensure tax fields are never sent to products table.
    delete updateData.igst_rate;
    delete updateData.cgst_rate;
    delete updateData.sgst_rate;
    delete updateData.igstRate;
    delete updateData.cgstRate;
    delete updateData.sgstRate;
    delete updateData.hsnCode;
    delete updateData.hsn_code;
    // LSA is a per-offer inventory attribute on supplier_products, not a catalog column.
    delete updateData.lsa;

    // Convert camelCase field names to snake_case for database
    if (updateData.minOrderQuantity !== undefined) {
      updateData.min_order_quantity = parseInt(updateData.minOrderQuantity) || 1;
      delete updateData.minOrderQuantity;
    }
    
    // Ensure numeric fields are properly typed
    if (updateData.price !== undefined) {
      updateData.price = parseFloat(updateData.price) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = parseInt(updateData.stock) || 0;
    }
    
    // Remove fields that shouldn't be updated directly on products
    delete updateData.id;
    delete updateData._id;
    delete updateData.supplier_id;
    delete updateData.supplier;
    delete updateData.supplier_product_id;
    delete updateData.supplierProductId;
    delete updateData.catalogProductId;
    delete updateData.supplierDescription;
    delete updateData.publishedDescription;
    delete updateData.created_at;
    delete updateData.status; // Status can only be changed via approve/reject endpoints
    delete updateData.approved_by;
    delete updateData.approved_at;
    delete updateData.rejection_reason;
    
    // Remove any undefined values to avoid Supabase errors
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    // Ensure specifications object is preserved as-is (including null values)
    if (updateData.specifications && typeof updateData.specifications === 'object') {
      // Keep all keys, even with null values - they represent specification keys that need values
      // Only remove undefined values, but keep null
      Object.keys(updateData.specifications).forEach(key => {
        if (updateData.specifications[key] === undefined) {
          delete updateData.specifications[key];
        }
        // Keep null values - they're placeholders for keys
      });
    }
    
    console.log('[ADMIN UPDATE] After cleanup - updateData keys:', Object.keys(updateData));
    console.log('[ADMIN UPDATE] After cleanup - updateData.category:', updateData.category);
    console.log('[ADMIN UPDATE] After cleanup - updateData.min_order_quantity:', updateData.min_order_quantity);
    console.log('[ADMIN UPDATE] After cleanup - updateData.specifications keys:', updateData.specifications ? Object.keys(updateData.specifications) : 'none');

    const { data: existingCatalogProduct } = await supabase
      .from('products')
      .select('id, name, category, brand, description, specifications, supplier_id, status')
      .eq('id', req.params.id)
      .maybeSingle();

    const { data: offerRowsForUpdate } = await supabase
      .from('supplier_products')
      .select(
        'id, product_id, supplier_id, price, stock, min_order_quantity, location, status, is_active, attributes, igst_rate, cgst_rate, sgst_rate, variant_key'
      )
      .eq('product_id', req.params.id);

    const earlyPrimarySupplierId =
      validatedBody?.supplier_id ||
      validatedBody?.supplier?.id ||
      existingCatalogProduct?.supplier_id ||
      null;
    const earlyTargetOfferRow = resolveAdminTargetOfferRow(offerRowsForUpdate || [], {
      validatedBody,
      catalogStatus: existingCatalogProduct?.status,
      primarySupplierId: earlyPrimarySupplierId
    });
    const preserveSharedCatalogIdentity = shouldPreserveSharedCatalogIdentity(
      existingCatalogProduct,
      earlyTargetOfferRow
    );
    if (preserveSharedCatalogIdentity) {
      SHARED_CATALOG_IDENTITY_KEYS.forEach((key) => {
        delete updateData[key];
      });
    }
    
    // Update product in Supabase
    const { data: product, error: updateError } = await supabase
      .from('products')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('[ADMIN UPDATE] Supabase update error:', updateError);
      console.error('[ADMIN UPDATE] Error code:', updateError.code);
      console.error('[ADMIN UPDATE] Error message:', updateError.message);
      console.error('[ADMIN UPDATE] Error details:', updateError.details);
      console.error('[ADMIN UPDATE] Error hint:', updateError.hint);
      
      return res.status(400).json({ 
        status: 'error',
        message: updateError.message || 'Product update failed',
        error: updateError.code || 'UPDATE_ERROR',
        details: updateError.details || null
      });
    }
    
    if (!product) {
      console.error('[ADMIN UPDATE] Product not found after update');
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found after update' 
      });
    }
    
    // Ensure specifications are included in response
    let productResponse = { ...product };
    if (!productResponse.specifications) {
      productResponse.specifications = {};
    }
    
    // Convert snake_case to camelCase for frontend compatibility
    if (productResponse.min_order_quantity !== undefined) {
      productResponse.minOrderQuantity = productResponse.min_order_quantity;
    }

    console.log('[ADMIN UPDATE] Product saved successfully');
    console.log('[ADMIN UPDATE] Product ID:', productResponse.id);
    console.log('[ADMIN UPDATE] Product name:', productResponse.name);
    console.log('[ADMIN UPDATE] Product category:', productResponse.category);
    console.log('[ADMIN UPDATE] Product price:', productResponse.price);
    console.log('[ADMIN UPDATE] Product stock:', productResponse.stock);
    console.log('[ADMIN UPDATE] Product min_order_quantity:', productResponse.min_order_quantity);
    console.log('[ADMIN UPDATE] Product specifications:', productResponse.specifications);
    console.log('[ADMIN UPDATE] Product specs keys count:', Object.keys(productResponse.specifications).length);
    console.log('[ADMIN UPDATE] Product specs keys:', Object.keys(productResponse.specifications));

    const requestedSpecsUpdate = validatedBody.specifications !== undefined;
    // Supplier portal reads live offer values from supplier_products (price/stock/location/
    // MOQ + attribute overrides). Admin UI still edits those fields, so mirror them here.
    // Tax/HSN already lived on supplier_products; extend the same sync for inventory/copy.
    // Specs must also sync: many customer/supplier UIs prefer or overwrite with
    // supplier_products.attributes.specifications.
    // Category/unit/images/brand also live on offer attributes and must mirror or suppliers
    // keep seeing the values stamped at create time.
    const requestedOfferInventoryUpdate =
      validatedBody.price !== undefined ||
      validatedBody.stock !== undefined ||
      validatedBody.location !== undefined ||
      validatedBody.minOrderQuantity !== undefined ||
      validatedBody.min_order_quantity !== undefined;
    const requestedNameUpdate = validatedBody.name !== undefined;
    const requestedDescriptionUpdate = validatedBody.description !== undefined;
    const requestedCategoryUpdate = validatedBody.category !== undefined;
    const requestedUnitUpdate = validatedBody.unit !== undefined;
    const requestedImagesUpdate = validatedBody.images !== undefined;
    const requestedBrandUpdate =
      validatedBody.brand !== undefined || validatedBody.brandModel !== undefined;
    const requestedGtinUpdate = validatedBody.gtin !== undefined;
    const requestedMpnUpdate = validatedBody.mpn !== undefined;
    const requestedBarcodeUpdate = validatedBody.barcode !== undefined;
    const requestedLsaUpdate = validatedBody.lsa !== undefined;
    const requestedCatalogIdentityUpdate =
      requestedCategoryUpdate ||
      requestedUnitUpdate ||
      requestedImagesUpdate ||
      requestedBrandUpdate ||
      requestedGtinUpdate ||
      requestedMpnUpdate ||
      requestedBarcodeUpdate;
    const shouldSyncSupplierOffers =
      requestedTaxUpdate ||
      requestedHsnUpdate ||
      requestedOfferInventoryUpdate ||
      requestedNameUpdate ||
      requestedDescriptionUpdate ||
      requestedSpecsUpdate ||
      requestedCatalogIdentityUpdate ||
      requestedLsaUpdate;

    if (shouldSyncSupplierOffers) {
      try {
        const offerPatch = {
          updated_at: new Date().toISOString()
        };
        if (requestedTaxUpdate) {
          offerPatch.igst_rate = normalizedTax.igst_rate;
          offerPatch.cgst_rate = normalizedTax.cgst_rate;
          offerPatch.sgst_rate = normalizedTax.sgst_rate;
        }
        if (updateData.price !== undefined) {
          offerPatch.price = updateData.price;
        }
        if (updateData.stock !== undefined) {
          offerPatch.stock = updateData.stock;
        }
        if (updateData.location !== undefined) {
          offerPatch.location = updateData.location;
        }
        if (updateData.min_order_quantity !== undefined) {
          offerPatch.min_order_quantity = updateData.min_order_quantity;
        }

        let spUpdateResult = null;
        const primarySupplierId =
          validatedBody?.supplier_id ||
          validatedBody?.supplier?.id ||
          productResponse?.supplier_id ||
          null;

        const offerRows = offerRowsForUpdate || [];
        const targetOfferRow =
          earlyTargetOfferRow ||
          resolveAdminTargetOfferRow(offerRows, {
            validatedBody,
            catalogStatus: productResponse?.status,
            primarySupplierId
          });

        const inventoryPatchKeys = new Set([
          'updated_at',
          'price',
          'stock',
          'location',
          'min_order_quantity',
          'igst_rate',
          'cgst_rate',
          'sgst_rate'
        ]);
        const inventoryPatch = Object.fromEntries(
          Object.entries(offerPatch).filter(([key]) => inventoryPatchKeys.has(key))
        );
        const hasInventoryPatch = Object.keys(inventoryPatch).length > 1;

        // Admin edits apply only to the targeted supplier offer. Broadcasting
        // name/category/specs to sibling offers overwrites other suppliers' listings.
        const rowsForAttributeSync = targetOfferRow ? [targetOfferRow] : [];
        spUpdateResult = rowsForAttributeSync;

        if (hasInventoryPatch && targetOfferRow?.id) {
          if (updateData.price !== undefined && targetOfferRow.variant_key) {
            await propagateVariantMrpToAllOffers(supabase, {
              productId: req.params.id,
              variantKey: targetOfferRow.variant_key,
              mrp: updateData.price
            });
            const patchWithoutPrice = { ...inventoryPatch };
            delete patchWithoutPrice.price;
            if (Object.keys(patchWithoutPrice).length > 1) {
              await supabase
                .from('supplier_products')
                .update(patchWithoutPrice)
                .eq('id', targetOfferRow.id);
            }
          } else {
            await supabase.from('supplier_products').update(inventoryPatch).eq('id', targetOfferRow.id);
          }
        }

        if (spUpdateResult && spUpdateResult.length > 0) {
          const safeAdminSpecs = requestedSpecsUpdate
            ? sanitizeSpecifications(validatedBody.specifications || {})
            : null;

          for (const row of spUpdateResult) {
            let mergedAttrs = { ...(row.attributes || {}) };

            if (requestedTaxUpdate) {
              mergedAttrs.igstRate = normalizedTax.igst_rate;
              mergedAttrs.cgstRate = normalizedTax.cgst_rate;
              mergedAttrs.sgstRate = normalizedTax.sgst_rate;
            }
            if (requestedHsnUpdate) {
              mergedAttrs.hsnCode = normalizedHsnCode || null;
            }
            if (requestedNameUpdate) {
              // Supplier list prefers attributes.listingName over products.name.
              mergedAttrs.listingName = String(validatedBody.name || '').trim();
            }
            if (requestedDescriptionUpdate) {
              mergedAttrs = buildAdminPublishedDescriptionAttributes(
                mergedAttrs,
                validatedBody.description || ''
              );
            }
            if (requestedCategoryUpdate) {
              mergedAttrs.category = String(
                validatedBody.category ?? productResponse.category ?? ''
              ).trim();
            }
            if (requestedUnitUpdate) {
              mergedAttrs.unit = String(validatedBody.unit ?? productResponse.unit ?? '').trim();
            }
            if (requestedImagesUpdate) {
              mergedAttrs.images = Array.isArray(validatedBody.images)
                ? validatedBody.images
                : Array.isArray(productResponse.images)
                  ? productResponse.images
                  : [];
            }
            if (requestedBrandUpdate) {
              const nextBrand = String(
                validatedBody.brand ?? productResponse.brand ?? mergedAttrs.brand ?? ''
              ).trim();
              if (nextBrand) mergedAttrs.brand = nextBrand;
              if (validatedBody.brandModel !== undefined) {
                mergedAttrs.brandModel = String(validatedBody.brandModel || '').trim();
              }
            }
            if (requestedGtinUpdate) {
              mergedAttrs.gtin = String(validatedBody.gtin ?? productResponse.gtin ?? '').trim();
            }
            if (requestedMpnUpdate) {
              mergedAttrs.mpn = String(validatedBody.mpn ?? productResponse.mpn ?? '').trim();
            }
            if (requestedBarcodeUpdate) {
              mergedAttrs.barcode = String(
                validatedBody.barcode ?? productResponse.barcode ?? ''
              ).trim();
            }
            // LSA is per-variant inventory — never broadcast to sibling offers.
            if (
              requestedLsaUpdate &&
              targetOfferRow?.id &&
              String(row.id) === String(targetOfferRow.id)
            ) {
              mergedAttrs.lsa = String(validatedBody.lsa ?? '').trim();
            }
            if (requestedSpecsUpdate) {
              // Push admin-filled values to supplier offers; keep supplier values when admin left blanks.
              const existingOfferSpecs =
                parseSpecificationsObject(mergedAttrs.specifications) || {};
              mergedAttrs = syncOfferAttributesWithSpecifications({
                ...mergedAttrs,
                specifications: mergeAdminEditedSpecificationsOntoOffer(
                  safeAdminSpecs || {},
                  existingOfferSpecs
                )
              });
            }

            await supabase
              .from('supplier_products')
              .update({
                attributes: syncOfferAttributesWithSpecifications(mergedAttrs),
                updated_at: new Date().toISOString()
              })
              .eq('id', row.id);
          }

          if (requestedTaxUpdate) {
            productResponse.igst_rate = normalizedTax.igst_rate;
            productResponse.cgst_rate = normalizedTax.cgst_rate;
            productResponse.sgst_rate = normalizedTax.sgst_rate;
          }
          if (requestedHsnUpdate) {
            productResponse.hsnCode = normalizedHsnCode || null;
          }
          if (offerPatch.price !== undefined) productResponse.price = offerPatch.price;
          if (offerPatch.stock !== undefined) productResponse.stock = offerPatch.stock;
          if (offerPatch.location !== undefined) productResponse.location = offerPatch.location;
          if (offerPatch.min_order_quantity !== undefined) {
            productResponse.min_order_quantity = offerPatch.min_order_quantity;
            productResponse.minOrderQuantity = offerPatch.min_order_quantity;
          }
          if (requestedLsaUpdate) {
            productResponse.lsa = String(validatedBody.lsa ?? '').trim();
          }
          if (requestedSpecsUpdate) {
            productResponse.specifications = safeAdminSpecs || {};
            console.log(
              `✅ [ADMIN UPDATE] Synced specifications to ${spUpdateResult.length} supplier offer(s)`
            );
          }
          if (requestedDescriptionUpdate) {
            const publishedText = String(validatedBody.description || '').trim();
            productResponse.description = publishedText;
            productResponse.publishedDescription = publishedText;
          }
          if (preserveSharedCatalogIdentity) {
            if (requestedNameUpdate) productResponse.name = String(validatedBody.name || '').trim();
            if (requestedCategoryUpdate) {
              productResponse.category = String(validatedBody.category || '').trim();
            }
            if (requestedBrandUpdate) {
              productResponse.brand = String(validatedBody.brand || productResponse.brand || '').trim();
            }
            if (requestedUnitUpdate) {
              productResponse.unit = String(validatedBody.unit || productResponse.unit || '').trim();
            }
          }

          void syncCatalogProductSnapshotFromOffers(supabase, req.params.id).catch((syncError) => {
            console.error('❌ [ADMIN UPDATE] Failed to refresh catalog snapshot from offers:', syncError);
          });
        } else {
          console.warn(
            '⚠️ [ADMIN UPDATE] No supplier_products rows found to sync offer fields for product:',
            req.params.id
          );
        }
      } catch (offerSyncError) {
        console.error('❌ [ADMIN UPDATE] Failed to sync offer fields on supplier_products:', offerSyncError);
        // Non-fatal: catalog product update succeeded.
      }
    }

    // If admin has set specifications for this product, sync them as:
    // 1) category default template (broad fallback), and
    // 2) model profile (exact same product match for all suppliers).
    try {
      const hasCategory = !!productResponse.category;
      const hasSpecs = !!productResponse.specifications;
      const hasSpecKeys = productResponse.specifications && Object.keys(productResponse.specifications).length > 0;
      
      console.log('🔄 [ADMIN SYNC] Checking sync conditions:');
      console.log('🔄 [ADMIN SYNC] - Has category?', hasCategory);
      console.log('🔄 [ADMIN SYNC] - Has specs object?', hasSpecs);
      console.log('🔄 [ADMIN SYNC] - Has spec keys?', hasSpecKeys);
      
      if (!preserveSharedCatalogIdentity && hasCategory && hasSpecs && hasSpecKeys) {
        const categoryName = String(productResponse.category).trim().toLowerCase();
        console.log(`🔄 [ADMIN SYNC] Syncing specs to category: "${categoryName}"`);
        console.log(`📦 [ADMIN SYNC] Product specs:`, productResponse.specifications);
        
        // Find or create the category
        let { data: category } = await supabase
          .from('categories')
          .select('*')
          .eq('name', categoryName)
          .single();
        
        if (!category) {
          // Category doesn't exist - create it
          console.log(`⚠️ [ADMIN SYNC] Category "${categoryName}" not found, creating it...`);
          const { data: newCategory } = await supabase
            .from('categories')
            .insert({
              name: categoryName,
              display_name: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
              is_active: true,
              created_by: req.userId
            })
            .select()
            .single();
          
          category = newCategory;
          console.log(`✅ [ADMIN SYNC] Created category "${categoryName}"`);
        }
        
        // Build template specs from product specifications
        const templateSpecs = {};
        const productSpecKeys = Object.keys(productResponse.specifications || {});
        console.log(`📋 [ADMIN SYNC] Product has ${productSpecKeys.length} specification keys:`, productSpecKeys);
        
        productSpecKeys.forEach((key) => {
          if (key && key.trim() !== '') {
            // Store only the key with null value so each supplier can
            // provide their own values for these admin-defined keys.
            templateSpecs[key] = null;
          }
        });

        // Only update if we actually have some keys
        if (Object.keys(templateSpecs).length > 0) {
          const safeSpecs = sanitizeSpecifications(productResponse.specifications || {});
          const { data: updatedCategory } = await supabase
            .from('categories')
            .update({
              default_specifications: templateSpecs,
              updated_at: new Date().toISOString()
            })
            .eq('id', category.id)
            .select()
            .single();
          
          console.log(`✅ [ADMIN SYNC] Updated defaultSpecifications for category "${category.name}"`);
          console.log(`📋 [ADMIN SYNC] Saved template specs:`, JSON.stringify(templateSpecs, null, 2));
          console.log(`🔑 [ADMIN SYNC] Total keys saved: ${Object.keys(templateSpecs).length}`);
          
          // Verify the save worked by fetching fresh from database
          const { data: verifyCategory } = await supabase
            .from('categories')
            .select('*')
            .eq('name', categoryName)
            .single();
          
          if (verifyCategory && verifyCategory.default_specifications) {
            const verifyKeys = Object.keys(verifyCategory.default_specifications);
            console.log(`✅ [ADMIN SYNC] Verified: Category "${categoryName}" now has ${verifyKeys.length} default specs`);
            console.log(`✅ [ADMIN SYNC] Verified keys:`, verifyKeys);
            console.log(`✅ [ADMIN SYNC] Verified specs object:`, JSON.stringify(verifyCategory.default_specifications, null, 2));
          } else {
            console.error(`❌ [ADMIN SYNC] Verification failed: Category "${categoryName}" defaultSpecifications not found after save`);
            console.error(`❌ [ADMIN SYNC] Verify category object:`, verifyCategory);
          }

          // Also persist model-level profile so "same product name/model"
          // in supplier portal resolves to this exact spec set.
          const modelRaw =
            String(productResponse.mpn || '').trim() ||
            String(productResponse.name || '').trim();
          const modelIdentifier = normalizeModelIdentifier(modelRaw);
          if (modelIdentifier) {
            const { error: modelSyncError } = await supabase
              .from('model_spec_profiles')
              .upsert(
                {
                  category: categoryName,
                  model_identifier: modelIdentifier,
                  display_model: modelRaw,
                  specifications: templateSpecs,
                  updated_by: req.userId,
                  updated_at: new Date().toISOString()
                },
                { onConflict: 'category,model_identifier' }
              );
            if (modelSyncError) {
              console.error('❌ [ADMIN SYNC] Failed to sync model_spec_profiles:', modelSyncError);
            } else {
              console.log(`✅ [ADMIN SYNC] Synced model profile for "${modelIdentifier}" in category "${categoryName}"`);
            }
          }
        } else {
          console.log(`ℹ️ [ADMIN SYNC] No valid keys to save for category "${categoryName}"`);
          console.log(`ℹ️ [ADMIN SYNC] Product specs keys:`, productSpecKeys);
          console.log(`ℹ️ [ADMIN SYNC] Template specs built:`, templateSpecs);
        }
      } else {
        console.log(`ℹ️ [ADMIN SYNC] Skipping sync - category: ${!!productResponse.category}, specs: ${!!productResponse.specifications}, keys: ${productResponse.specifications ? Object.keys(productResponse.specifications).length : 0}`);
      }
    } catch (syncError) {
      // Do not block the main response if syncing category template fails
      console.error('❌ [ADMIN SYNC] Failed to sync category defaultSpecifications from admin product update:', syncError);
    }

    try {
      productResponse = await reconcileAdminProductWithOffers(supabase, productResponse);
    } catch (reconcileError) {
      console.warn('[ADMIN UPDATE] Failed to reconcile supplier offer specifications:', reconcileError);
    }
    
    res.json({
      status: 'success',
      message: 'Product updated successfully',
      product: productResponse
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update product error:', error);
    
    // Handle Supabase validation errors
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        status: 'error',
        message: 'Validation Error',
        errors: ['Duplicate entry']
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

}
