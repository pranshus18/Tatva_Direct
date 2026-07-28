/** Supplier routes: productList */
import { parseSupplierStockQuantity } from '../../utils/parseSupplierStockQuantity.js';
import { expireStaleReservations } from '../../services/checkoutInventoryReservationService.js';
import {
  PRODUCT_IMAGES_BUCKET,
  uploadFile
} from './supplierImports.js';
import {
  sanitizeImageUrls,
  supplierOfferTsinFields,
  resolveEffectiveSupplierOfferState
} from './shared/productHelpers.js';
import { mergeProductImageLists } from '../../services/productImageService.js';
import { catalogBrandDedupKey, normalizeBrandKey } from '../../services/supplyChainSharedService.js';

export function registerSupplierProductListRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    productImageUpload,
    resolveTaxRatesForProductCreate
  } = ctx;

router.get('/products', authenticateToken, async (req, res) => {
  try {
    // Scoped to this supplier's own holds — no need to sweep the whole platform on every page load.
    await expireStaleReservations({ supplierId: req.userId });

    // Fetch all of this supplier's offers, including pending, approved, and rejected,
    // so the portal stays in sync with admin approval status.
    const { data: supplierProducts, error: supplierProductsError } = await supabase
      .from('supplier_products')
      .select(`
        *,
        product:products(*)
      `)
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: false });
    
    if (supplierProductsError) {
      // Fallback: try fetching from products table (for backward compatibility)
      console.log('Error fetching from supplier_products, trying products table:', supplierProductsError);
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
      
      return res.json({ 
        status: 'success',
        products: products || []
      });
    }
    
    // Heal stale junction rows before building the response so Total/Active counters
    // and card status match Admin approval immediately.
    const offerIdsNeedingSync = (supplierProducts || [])
      .filter((sp) => resolveEffectiveSupplierOfferState(sp, sp.product).needsCatalogSync)
      .map((sp) => sp.id)
      .filter(Boolean);
    if (offerIdsNeedingSync.length > 0) {
      const syncAt = new Date().toISOString();
      const { error: syncErr } = await supabase
        .from('supplier_products')
        .update({
          status: 'approved',
          is_active: true,
          updated_at: syncAt
        })
        .in('id', offerIdsNeedingSync);
      if (syncErr) {
        console.warn(
          '[SupplierProducts] Failed to sync approved catalog status onto offers:',
          syncErr.message || syncErr
        );
      } else {
        const syncIdSet = new Set(offerIdsNeedingSync.map(String));
        for (const sp of supplierProducts || []) {
          if (syncIdSet.has(String(sp.id))) {
            sp.status = 'approved';
            sp.is_active = true;
            sp.updated_at = syncAt;
          }
        }
      }
    }

    // Own-catalog list: never hide offers by brand profile matching.
    // Brand access is enforced at create/update time; filtering here caused approved
    // products to disappear from the supplier portal after admin approval.
    const products = (supplierProducts || [])
      .map((sp) => {
        const attributes =
          typeof sp.attributes === 'string'
            ? (() => {
                try {
                  return JSON.parse(sp.attributes);
                } catch {
                  return {};
                }
              })()
            : sp.attributes && typeof sp.attributes === 'object'
              ? sp.attributes
              : {};

        const baseProduct = sp.product || null;
        const baseSpecs =
          baseProduct?.specifications && typeof baseProduct.specifications === 'object'
            ? baseProduct.specifications
            : {};
        const offerSpecs =
          attributes?.specifications && typeof attributes.specifications === 'object'
            ? attributes.specifications
            : {};
        // Catalog/admin specs win over stale offer copies for the same keys.
        // Offer-only keys that are not on the catalog product are still preserved.
        const storedSpecs = { ...offerSpecs, ...baseSpecs };
        const listingName =
          attributes?.listingName != null && String(attributes.listingName).trim() !== ''
            ? String(attributes.listingName).trim()
            : baseProduct?.name ||
              (attributes?.name != null && String(attributes.name).trim() !== ''
                ? String(attributes.name).trim()
                : 'Product');
        const displayBrand = attributes?.brand || baseProduct?.brand || '';
        const offerImages = sanitizeImageUrls(attributes?.images);
        const baseImages = sanitizeImageUrls(baseProduct?.images);

        const effective = resolveEffectiveSupplierOfferState(sp, baseProduct);
        const rejectionReason =
          sp.rejection_reason ||
          baseProduct?.rejection_reason ||
          null;

        return {
          ...(baseProduct || { id: sp.product_id }),
          // Per-variant display: offer overrides shared catalog (same merge as PUT response)
          name: listingName,
          supplierDescription:
            attributes?.supplierDescription ||
            attributes?.description ||
            '',
          publishedDescription: baseProduct?.description || '',
          description:
            attributes?.supplierDescription ||
            attributes?.description ||
            baseProduct?.description ||
            '',
          brand: displayBrand || baseProduct?.brand || '',
          category: attributes?.category || baseProduct?.category || '',
          unit: attributes?.unit || baseProduct?.unit || '',
          gtin: attributes?.gtin || baseProduct?.gtin,
          mpn: attributes?.mpn || baseProduct?.mpn,
          specifications: storedSpecs,
          images: mergeProductImageLists(offerImages, baseImages),
          price: sp.price,
          stock: parseSupplierStockQuantity(sp.stock) ?? 0,
          igst_rate: sp.igst_rate ?? attributes?.igstRate ?? null,
          cgst_rate: sp.cgst_rate ?? attributes?.cgstRate ?? null,
          sgst_rate: sp.sgst_rate ?? attributes?.sgstRate ?? null,
          location: sp.location,
          min_order_quantity: sp.min_order_quantity,
          status: effective.effectiveStatus,
          is_active: effective.effectiveActive,
          rejection_reason: rejectionReason,
          rejectionReason,
          approved_by: sp.approved_by,
          approved_at: sp.approved_at,
          supplier_id: sp.supplier_id,
          ...supplierOfferTsinFields(baseProduct || { asin: null }, sp),
          brandModel: attributes?.brandModel,
          lsa: attributes?.lsa,
          hsnCode: attributes?.hsnCode,
          supplier_product_id: sp.id,
          variantKey: sp.variant_key || null,
          variantAsin: sp.variant_asin || null,
          attributes,
          catalogMissing: !baseProduct
        };
      })
      .filter(Boolean);

    // Attach brand approval status so cards can warn when brand is not approved yet.
    try {
      const brandKeys = new Set();
      for (const product of products) {
        const brandLabel = String(product?.brand || product?.brandModel || '').trim();
        const key = catalogBrandDedupKey(brandLabel) || normalizeBrandKey(brandLabel);
        if (key) brandKeys.add(key);
      }

      let brandStatusByKey = new Map();
      if (brandKeys.size > 0) {
        const { data: brandRows } = await supabase
          .from('brands')
          .select('name, normalized_name, status, rejection_reason');
        brandStatusByKey = new Map();
        for (const row of brandRows || []) {
          const name = String(row?.name || '').trim();
          const key =
            catalogBrandDedupKey(name) ||
            normalizeBrandKey(name) ||
            normalizeBrandKey(row?.normalized_name);
          if (!key) continue;
          brandStatusByKey.set(key, row);
        }
      }

      for (const product of products) {
        const brandLabel = String(product?.brand || product?.brandModel || '').trim();
        const key = catalogBrandDedupKey(brandLabel) || normalizeBrandKey(brandLabel);
        const row = key ? brandStatusByKey.get(key) : null;
        if (!brandLabel) {
          product.brandApprovalStatus = 'missing';
          product.brandApprovalMessage = '';
          continue;
        }
        if (!row) {
          product.brandApprovalStatus = 'unregistered';
          product.brandApprovalMessage = `Brand approval required for "${brandLabel}".`;
          continue;
        }
        const brandStatus = String(row.status || 'pending').toLowerCase();
        product.brandApprovalStatus = brandStatus;
        if (brandStatus === 'approved') {
          product.brandApprovalMessage = '';
        } else if (brandStatus === 'rejected') {
          product.brandApprovalMessage = row.rejection_reason
            ? `Brand "${row.name || brandLabel}" was rejected: ${row.rejection_reason}`
            : `Brand "${row.name || brandLabel}" was rejected by admin.`;
        } else {
          product.brandApprovalMessage = `Brand approval pending for "${row.name || brandLabel}".`;
        }
      }
    } catch (brandStatusError) {
      console.warn(
        'Supplier product list brand status enrichment failed:',
        brandStatusError?.message || brandStatusError
      );
    }

    const list = products || [];
    const stats = {
      total: list.length,
      active: 0,
      pending: 0,
      rejected: 0
    };
    for (const product of list) {
      const status = String(product?.status || 'pending').toLowerCase();
      if (status === 'rejected') {
        stats.rejected += 1;
      } else if (status === 'approved' || product?.is_active === true) {
        stats.active += 1;
      } else {
        stats.pending += 1;
      }
    }
    
    res.json({ 
      status: 'success',
      products: list,
      stats
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.post(
  '/products/upload-image',
  authenticateToken,
  productImageUpload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'Image file is required' });
      }
      if (!String(req.file.mimetype || '').startsWith('image/')) {
        return res.status(400).json({ status: 'error', message: 'Only image files are allowed' });
      }

      const supplierProductId = String(req.body?.supplierProductId || '').trim() || 'draft';
      const safeOriginalName = String(req.file.originalname || 'product-image.jpg')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${req.userId}/${supplierProductId}/${Date.now()}-${safeOriginalName}`;
      const { url } = await uploadFile(PRODUCT_IMAGES_BUCKET, path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

      return res.status(201).json({
        status: 'success',
        message: 'Product image uploaded successfully',
        url
      });
    } catch (error) {
      console.error('Product image upload error:', error);
      return res.status(500).json({
        status: 'error',
        message:
          error?.message && String(error.message).includes('Bucket not found')
            ? `${error.message} Set SUPABASE_STORAGE_PRODUCT_BUCKET in backend .env and restart server.`
            : 'Failed to upload product image'
      });
    }
  }
);

// ================= OUTLETS & LOCATIONS =================

// CRUD for supplier outlets (stores / warehouses)

// List outlets for the logged-in supplier
}
