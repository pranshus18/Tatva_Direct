/** Supplier routes: productList */
import { parseSupplierStockQuantity } from '../../utils/parseSupplierStockQuantity.js';
import { expireStaleReservations } from '../../services/checkoutInventoryReservationService.js';
import {
  PRODUCT_IMAGES_BUCKET,
  resolveUpstreamBrandLabel,
  supplierCanAccessBrandStrict,
  mergeSpecificationMaps,
  uploadFile
} from './supplierImports.js';
import {
  sanitizeImageUrls,
  supplierOfferTsinFields,
  resolveEffectiveSupplierOfferState
} from './shared/productHelpers.js';
import { mergeProductImageLists } from '../../services/productImageService.js';

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

    const { data: profileRow } = await supabase
      .from('users')
      .select('profile')
      .eq('id', req.userId)
      .maybeSingle();
    const effectiveProfile = profileRow?.profile || req.user?.profile || {};

    // Fetch products with supplier_products join
    const { data: supplierProducts, error: supplierProductsError } = await supabase
      .from('supplier_products')
      .select(`
        *,
        product:products(*)
      `)
      .eq('supplier_id', req.userId)
      // If admin rejects a product, we update supplier_products.status = 'rejected'
      // and we want the rejected item to disappear from the supplier portal.
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });
    
    if (supplierProductsError) {
      // Fallback: try fetching from products table (for backward compatibility)
      console.log('Error fetching from supplier_products, trying products table:', supplierProductsError);
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('supplier_id', req.userId)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
      
      return res.json({ 
        status: 'success',
        products: products || []
      });
    }
    
    // Combine product and supplier_products data.
    // If an admin deletes the shared product but a junction row remains (unexpected legacy data),
    // skip the row so the supplier UI doesn't show "ghost" products.
    const visibleSupplierProducts = (supplierProducts || []).filter((sp) => {
      const brandCandidate = resolveUpstreamBrandLabel(sp?.attributes, sp?.product?.brand);
      return supplierCanAccessBrandStrict(effectiveProfile, brandCandidate).allowed;
    });

    const products = visibleSupplierProducts
      .map((sp) => {
        if (!sp.product) return null;

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

        const baseSpecs =
          sp.product?.specifications && typeof sp.product.specifications === 'object'
            ? sp.product.specifications
            : {};
        const offerSpecs =
          attributes?.specifications && typeof attributes.specifications === 'object'
            ? attributes.specifications
            : {};
        const storedSpecs = mergeSpecificationMaps(baseSpecs, offerSpecs);
        const listingName =
          attributes?.listingName != null && String(attributes.listingName).trim() !== ''
            ? String(attributes.listingName).trim()
            : sp.product.name;
        const displayBrand = attributes?.brand || sp.product.brand || '';
        const offerImages = sanitizeImageUrls(attributes?.images);
        const baseImages = sanitizeImageUrls(sp.product?.images);

        const effective = resolveEffectiveSupplierOfferState(sp, sp.product);

        return {
          ...sp.product,
          // Per-variant display: offer overrides shared catalog (same merge as PUT response)
          name: listingName,
          supplierDescription:
            attributes?.supplierDescription ||
            attributes?.description ||
            '',
          publishedDescription: sp.product?.description || '',
          description:
            attributes?.supplierDescription ||
            attributes?.description ||
            sp.product?.description ||
            '',
          brand: displayBrand || sp.product.brand,
          gtin: attributes?.gtin || sp.product.gtin,
          mpn: attributes?.mpn || sp.product.mpn,
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
          rejection_reason: sp.rejection_reason,
          approved_by: sp.approved_by,
          approved_at: sp.approved_at,
          supplier_id: sp.supplier_id,
          ...supplierOfferTsinFields(sp.product, sp),
          brandModel: attributes?.brandModel,
          lsa: attributes?.lsa,
          hsnCode: attributes?.hsnCode,
          supplier_product_id: sp.id,
          variantKey: sp.variant_key || null,
          variantAsin: sp.variant_asin || null,
          attributes
        };
      })
      .filter(Boolean);
    
    res.json({ 
      status: 'success',
      products: products || []
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
