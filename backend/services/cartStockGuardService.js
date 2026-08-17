import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import {
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  BUYER_OWN_LISTING_PURCHASE_MESSAGE,
  isExcludedBuyerSupplierOffer
} from './catalogOfferSnapshotService.js';

export const PRODUCT_OUT_OF_STOCK_MESSAGE = 'Product is out of stock';
export { BUYER_OWN_LISTING_PURCHASE_MESSAGE };

function detectProductBrand(product = {}) {
  return (
    String(product?.brand || '').trim() ||
    String(product?.specifications?.brand || '').trim() ||
    String(product?.specifications?.brandModel || '').trim()
  );
}

/**
 * Sum sellable stock for a product from terminal-role-eligible approved listings.
 * @returns {Promise<{ ok: true, availableStock: number, product: object } | { ok: false, status: number, message: string }>}
 */
export async function getSellableProductStock(
  supabase,
  { productId, variantKey = '', product: preloadedProduct = null, excludeSupplierId = null } = {}
) {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) {
    return { ok: false, status: 400, message: 'productId is required' };
  }

  let product = preloadedProduct;
  if (!product) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, unit, brand, specifications, status')
      .eq('id', normalizedProductId)
      .maybeSingle();
    if (error) throw error;
    product = data;
  }

  if (!product || String(product.status || '').toLowerCase() !== 'approved') {
    return { ok: false, status: 404, message: 'Product not found' };
  }

  let listingQuery = supabase
    .from('supplier_products')
    .select('id, stock, variant_key, supplier_id, supplier:users!supplier_products_supplier_id_fkey(id, profile)')
    .eq('product_id', normalizedProductId)
    .eq('status', 'approved')
    .eq('is_active', true)
    .limit(200);

  const normalizedVariantKey = String(variantKey || '').trim();
  if (normalizedVariantKey) {
    listingQuery = listingQuery.eq('variant_key', normalizedVariantKey);
  }

  const { data: activeListings, error: listingError } = await listingQuery;
  if (listingError) throw listingError;

  const brandLabel = detectProductBrand(product);
  const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(
    supabase,
    brandLabel ? [brandLabel] : []
  );

  const eligibleListings = (activeListings || []).filter((row) => {
    if (isExcludedBuyerSupplierOffer(row, excludeSupplierId)) return false;
    return supplierMatchesBrandTerminalRole(
      row?.supplier?.profile || {},
      brandLabel,
      terminalRoleByBrandMap
    );
  });

  if (eligibleListings.length === 0) {
    const hadOwnListing = (activeListings || []).some((row) =>
      isExcludedBuyerSupplierOffer(row, excludeSupplierId)
    );
    return {
      ok: false,
      status: 400,
      message: hadOwnListing
        ? BUYER_OWN_LISTING_PURCHASE_MESSAGE
        : "This product is not currently listed by the terminal role supplier for this brand's supply chain."
    };
  }

  const availableStock = eligibleListings.reduce(
    (sum, row) => sum + (parseSupplierStockQuantity(row?.stock) ?? 0),
    0
  );

  return {
    ok: true,
    availableStock,
    product,
    eligibleListingCount: eligibleListings.length
  };
}

/**
 * Ensure a product has enough sellable stock for the requested quantity.
 */
export async function assertProductHasSellableStock(
  supabase,
  { productId, variantKey = '', quantity = 1, product = null, excludeSupplierId = null } = {}
) {
  const requestedQty = Math.max(1, Math.floor(Number(quantity) || 1));
  const stockResult = await getSellableProductStock(supabase, {
    productId,
    variantKey,
    product,
    excludeSupplierId
  });

  if (!stockResult.ok) return stockResult;

  if (stockResult.availableStock < 1) {
    return {
      ok: false,
      status: 400,
      message: PRODUCT_OUT_OF_STOCK_MESSAGE,
      availableStock: 0
    };
  }

  if (stockResult.availableStock < requestedQty) {
    return {
      ok: false,
      status: 400,
      message:
        stockResult.availableStock === 0
          ? PRODUCT_OUT_OF_STOCK_MESSAGE
          : `Only ${stockResult.availableStock} unit${stockResult.availableStock === 1 ? '' : 's'} available in stock`,
      availableStock: stockResult.availableStock
    };
  }

  return stockResult;
}

/**
 * Validate every cart line that references a catalog productId.
 */
export async function assertCartDraftItemsHaveSellableStock(
  supabase,
  draftPayload = {},
  { excludeSupplierId = null } = {}
) {
  const groups = Array.isArray(draftPayload?.boqGroups) ? draftPayload.boqGroups : [];
  const flatItems = Array.isArray(draftPayload?.items) ? draftPayload.items : [];
  const lines = [
    ...groups.flatMap((group) => (Array.isArray(group?.items) ? group.items : [])),
    ...flatItems
  ];

  const demandByKey = new Map();
  for (const item of lines) {
    const productId = String(item?.productId || item?.product_id || '').trim();
    if (!productId) continue;
    const variantKey = String(item?.variantKey || item?.variant_key || '').trim();
    const key = `${productId}::${variantKey}`;
    const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    demandByKey.set(key, (demandByKey.get(key) || 0) + qty);
  }

  for (const [key, quantity] of demandByKey.entries()) {
    const [productId, variantKey] = key.split('::');
    const result = await assertProductHasSellableStock(supabase, {
      productId,
      variantKey: variantKey || '',
      quantity,
      excludeSupplierId
    });
    if (!result.ok) {
      const name = result.product?.name ? ` (${result.product.name})` : '';
      return {
        ok: false,
        status: result.status,
        message:
          result.message === PRODUCT_OUT_OF_STOCK_MESSAGE
            ? `Product is out of stock${name}`
            : result.message
      };
    }
  }

  return { ok: true };
}
