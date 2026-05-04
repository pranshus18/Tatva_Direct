import { normalizeBrandKey, parseFiniteNumber } from './procurementSharedService.js';

export async function loadBuyerCovMetrics({ supabase, userId }) {
  const { data: buyerPaidOrders, error: buyerPaidOrdersError } = await supabase
    .from('orders')
    .select('id, supplier_id, total_amount')
    .eq('service_provider_id', userId)
    .eq('channel', 'b2b_po')
    .eq('payment_status', 'paid');
  if (buyerPaidOrdersError) {
    throw buyerPaidOrdersError;
  }

  const paidOrders = buyerPaidOrders || [];
  const platformCov = paidOrders.reduce((sum, row) => sum + (parseFiniteNumber(row.total_amount) || 0), 0);

  const supplierCovById = new Map();
  for (const row of paidOrders) {
    if (!row?.supplier_id) continue;
    supplierCovById.set(
      row.supplier_id,
      (supplierCovById.get(row.supplier_id) || 0) + (parseFiniteNumber(row.total_amount) || 0)
    );
  }

  const paidOrderIds = [...new Set(paidOrders.map((row) => row.id).filter(Boolean))];
  const brandCovByBrand = new Map();
  if (paidOrderIds.length > 0) {
    const { data: paidOrderItems, error: paidOrderItemsError } = await supabase
      .from('order_items')
      .select('order_id, product_id, total_price')
      .in('order_id', paidOrderIds);
    if (!paidOrderItemsError) {
      const productIds = [...new Set((paidOrderItems || []).map((row) => row.product_id).filter(Boolean))];
      const productsById = new Map();
      if (productIds.length > 0) {
        const { data: covProducts, error: covProductsError } = await supabase
          .from('products')
          .select('id, brand, specifications')
          .in('id', productIds);
        if (!covProductsError) {
          for (const p of covProducts || []) {
            productsById.set(p.id, p);
          }
        }
      }
      for (const item of paidOrderItems || []) {
        const product = productsById.get(item.product_id) || {};
        const specs = product?.specifications || {};
        const brandKey = normalizeBrandKey(
          product?.brand || specs?.brand || specs?.brandModel || specs?.modelBrand || ''
        );
        if (!brandKey) continue;
        const amount = parseFiniteNumber(item.total_price) || 0;
        if (amount <= 0) continue;
        brandCovByBrand.set(brandKey, (brandCovByBrand.get(brandKey) || 0) + amount);
      }
    }
  }

  return {
    platformCov,
    supplierCovById,
    brandCovByBrand
  };
}
