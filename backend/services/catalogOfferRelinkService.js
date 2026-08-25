import { catalogOfferIdentityConflicts } from '../utils/catalogProductAttach.js';
import { buildIdentityBundle } from './productIdentityService.js';
import {
  parseSpecificationsObject,
  parseSupplierOfferAttributes
} from './supplierCatalogHelpersService.js';
import {
  createBaseProductIfNeeded,
  resolveSupplierOfferDisplayName
} from './supplierProductWriteService.js';

export function offerConflictsWithCatalogProduct(catalogProduct, offerRow) {
  const attrs = parseSupplierOfferAttributes(offerRow?.attributes);
  return catalogOfferIdentityConflicts(catalogProduct, attrs);
}

/**
 * If an offer was attached to the wrong shared catalog product (Nothing Power
 * on a JBL headphones TSIN), create a matching catalog row and move the offer.
 */
export async function relinkConflictingOfferToOwnCatalog(
  supabase,
  { catalogProduct, offerRow, reqUserId } = {}
) {
  if (!supabase || !catalogProduct?.id || !offerRow?.id) {
    return { relinked: false, catalogProduct, offerRow };
  }
  if (!offerConflictsWithCatalogProduct(catalogProduct, offerRow)) {
    return { relinked: false, catalogProduct, offerRow };
  }

  const attrs = parseSupplierOfferAttributes(offerRow.attributes);
  const listingName = resolveSupplierOfferDisplayName({
    attributes: attrs,
    catalogName: ''
  });
  if (!listingName || listingName === 'Product') {
    return { relinked: false, catalogProduct, offerRow };
  }

  const listingBrand = String(attrs.brand || attrs.brandModel || '').trim();
  const listingCategory = String(attrs.category || catalogProduct.category || '').trim();
  const listingUnit = String(attrs.unit || catalogProduct.unit || '').trim();
  const listingSpecs = parseSpecificationsObject(attrs.specifications) || {};
  const listingImages = Array.isArray(attrs.images) ? attrs.images.filter(Boolean) : [];
  const identityBundle = buildIdentityBundle({
    name: listingName,
    category: listingCategory,
    brand: listingBrand,
    unit: listingUnit,
    gtin: attrs.gtin,
    mpn: attrs.mpn,
    specifications: listingSpecs
  });

  const created = await createBaseProductIfNeeded(supabase, {
    existingProduct: null,
    otherData: {
      name: listingName,
      price: offerRow.price,
      stock: offerRow.stock,
      min_order_quantity: offerRow.min_order_quantity,
      location: offerRow.location
    },
    categoryName: listingCategory,
    unitName: listingUnit,
    normalizedImageUrls: listingImages,
    normalizedSpecs: listingSpecs,
    reqUserId: reqUserId || offerRow.supplier_id || catalogProduct.supplier_id,
    identityBundle,
    resolvedBarcodeForPos: null
  });

  if (!created?.productId || created.error) {
    return { relinked: false, catalogProduct, offerRow, error: created?.error || created?.publicError };
  }
  if (String(created.productId) === String(catalogProduct.id)) {
    return { relinked: false, catalogProduct, offerRow };
  }

  const { data: updatedOffer, error: updateError } = await supabase
    .from('supplier_products')
    .update({
      product_id: created.productId,
      updated_at: new Date().toISOString()
    })
    .eq('id', offerRow.id)
    .select()
    .maybeSingle();

  if (updateError) {
    return { relinked: false, catalogProduct, offerRow, error: updateError };
  }

  const { data: newCatalog } = await supabase
    .from('products')
    .select('*')
    .eq('id', created.productId)
    .maybeSingle();

  return {
    relinked: true,
    catalogProduct: newCatalog || {
      ...catalogProduct,
      id: created.productId,
      name: listingName,
      brand: listingBrand,
      category: listingCategory,
      status: 'pending',
      is_active: false
    },
    offerRow: updatedOffer || { ...offerRow, product_id: created.productId }
  };
}
