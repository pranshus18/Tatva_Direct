/** Supplier routes: analytics */
import {
  buildOrderNetRevenueMap,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
} from './supplierImports.js';
import {
  isRevenueRecognizedOrder
} from './shared/productHelpers.js';

export function registerSupplierAnalyticsRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveTaxRatesForProductCreate
  } = ctx;

router.get('/analytics/sales-by-channel', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const { from, to } = req.query;

    // 1) Fetch orders for this supplier
    let ordersQuery = supabase
      .from('orders')
      .select('id, channel, total_amount, created_at, payment_status')
      .eq('supplier_id', supplierId);

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery;
    if (ordersError) {
      throw ordersError;
    }

    const recognizedOrders = (orders || []).filter((o) => isRevenueRecognizedOrder(o));
    const orderIds = recognizedOrders.map((o) => o.id);
    if (orderIds.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalRevenue: 0,
          totalOrders: 0,
          channels: []
        },
        products: []
      });
    }

    // 2) Fetch order_items for these orders
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, order_id, product_id, quantity, unit_price, total_price')
      .in('order_id', orderIds);
    const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
      supabase,
      orderIds
    );


    if (itemsError) {
      throw itemsError;
    }

    // 3) Fetch product names for reporting
    const productIds = [...new Set((orderItems || []).map(i => i.product_id).filter(Boolean))];
    let productsMap = {};
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, category')
        .in('id', productIds);
      (products || []).forEach(p => { productsMap[p.id] = p; });
    }

    const ordersById = {};
    recognizedOrders.forEach(o => { ordersById[o.id] = o; });

    // 4) Aggregate by channel and product
    const channelAgg = {};
    const productAgg = {};
    let totalRevenue = 0;

    (orderItems || []).forEach(item => {
      const order = ordersById[item.order_id];
      if (!order) return;
      const channel = order.channel || 'unknown';

      const metrics = getNetItemMetrics(item, closedReturnedQtyByOrderItem);
      const qty = metrics.netQty;
      const revenue = metrics.netRevenue;
      if (qty <= 0 || revenue <= 0) return;

      totalRevenue += revenue;

      // Channel-level
      if (!channelAgg[channel]) {
        channelAgg[channel] = { channel, revenue: 0, quantity: 0, orderCount: 0 };
      }
      channelAgg[channel].revenue += revenue;
      channelAgg[channel].quantity += qty;
      channelAgg[channel].orderCount += 1;

      // Product-level
      const pid = item.product_id || 'unknown';
      if (!productAgg[pid]) {
        const p = productsMap[pid] || {};
        productAgg[pid] = {
          productId: pid,
          name: p.name || 'Unknown Product',
          category: p.category || null,
          onlineQty: 0,
          offlineQty: 0,
          onlineRevenue: 0,
          offlineRevenue: 0,
          totalQty: 0,
          totalRevenue: 0
        };
      }
      const rec = productAgg[pid];
      const isOffline = channel === 'offline_sale';

      rec.totalQty += qty;
      rec.totalRevenue += revenue;
      if (isOffline) {
        rec.offlineQty += qty;
        rec.offlineRevenue += revenue;
      } else {
        rec.onlineQty += qty;
        rec.onlineRevenue += revenue;
      }
    });

    const channels = Object.values(channelAgg).map(c => ({
      ...c,
      revenue: c.revenue,
      quantity: c.quantity
    }));

    const products = Object.values(productAgg)
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 50);

    res.json({
      status: 'success',
      summary: {
        totalRevenue,
        totalOrders: recognizedOrders.length,
        channels
      },
      products
    });
  } catch (error) {
    console.error('Supplier sales-by-channel analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Purchase-focused analytics for supplier portal:
// what supplier purchases from upstream partners, brand-wise totals.
router.get('/analytics/discount-insights', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();

    let ordersQuery = supabase
      .from('orders')
      .select('id, total_amount, supplier_id, status, payment_status, channel')
      .eq('service_provider_id', supplierId)
      .eq('channel', 'b2b_po');

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery;

    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    const orderIds = ordersList.map((order) => order.id).filter(Boolean);

    if (orderIds.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalUpstreamSuppliers: 0,
          totalOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0
        },
        brands: []
      });
    }

    const uniqueUpstreamSupplierIds = new Set(
      ordersList.map((order) => order.supplier_id).filter(Boolean)
    );

    const totalPurchaseValue = ordersList.reduce(
      (sum, order) => sum + (parseFloat(order.total_amount || 0) || 0),
      0
    );
    const paidPurchaseOrderIds = new Set(
      ordersList
        .filter((order) => String(order.payment_status || '').toLowerCase() === 'paid')
        .map((order) => order.id)
        .filter(Boolean)
    );

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, order_id, quantity, unit_price, total_price, product_id, supplier_product_id')
      .in('order_id', orderIds);
    if (itemsError) {
      throw itemsError;
    }

    const itemsList = orderItems || [];
    const supplierProductIds = [
      ...new Set(itemsList.map((item) => item.supplier_product_id).filter(Boolean))
    ];
    const productIds = [...new Set(itemsList.map((item) => item.product_id).filter(Boolean))];

    let supplierProductById = new Map();
    if (supplierProductIds.length > 0) {
      const { data: supplierProducts } = await supabase
        .from('supplier_products')
        .select('id, attributes')
        .in('id', supplierProductIds);
      supplierProductById = new Map((supplierProducts || []).map((row) => [row.id, row]));
    }

    let productById = new Map();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, name, category')
        .in('id', productIds);
      productById = new Map((products || []).map((row) => [row.id, row]));
    }

    const brandAgg = new Map();

    for (const item of itemsList) {
      const supplierProduct = supplierProductById.get(item.supplier_product_id) || {};
      const product = productById.get(item.product_id) || {};
      const attrs = supplierProduct.attributes || {};

      const brandName =
        String(attrs.brandModel || attrs.brand || product.name || product.category || 'Unspecified')
          .trim() || 'Unspecified';
      const quantity = parseFloat(item.quantity || 0) || 0;
      const purchaseValue = parseFloat(item.total_price || 0) || 0;
      if (quantity <= 0 || purchaseValue <= 0) {
        continue;
      }

      if (!brandAgg.has(brandName)) {
        brandAgg.set(brandName, {
          brand: brandName,
          orderValue: 0,
          itemQty: 0
        });
      }

      const rec = brandAgg.get(brandName);
      rec.orderValue += purchaseValue;
      rec.itemQty += quantity;
    }

    const paidPurchaseValue = itemsList.reduce((sum, item) => {
      if (!paidPurchaseOrderIds.has(item.order_id)) {
        return sum;
      }
      return sum + (parseFloat(item.total_price || 0) || 0);
    }, 0);

    const brands = [...brandAgg.values()]
      .sort((a, b) => b.orderValue - a.orderValue)
      .slice(0, 20);

    return res.json({
      status: 'success',
      summary: {
        totalUpstreamSuppliers: uniqueUpstreamSupplierIds.size,
        totalOrders: ordersList.length,
        totalPurchaseValue,
        paidPurchaseValue
      },
      brands
    });
  } catch (error) {
    console.error('Supplier discount insights analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Buyer-wise purchase tracking for supplier portal.
router.get('/analytics/upstream-supplier-purchase-totals', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({
        status: 'error',
        message: 'Only suppliers can view upstream purchase totals'
      });
    }

    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const top = parseInt(req.query?.top, 10);

    let ordersQuery = supabase
      .from('orders')
      .select('id, supplier_id, total_amount, status, payment_status, created_at')
      .eq('service_provider_id', req.userId)
      .eq('channel', 'b2b_po');

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery.order('created_at', { ascending: false });
    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    if (ordersList.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalSuppliers: 0,
          totalOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0
        },
        suppliers: []
      });
    }

    const upstreamSupplierIds = [
      ...new Set(ordersList.map((order) => order.supplier_id).filter(Boolean))
    ];
    let suppliersById = new Map();
    if (upstreamSupplierIds.length > 0) {
      const { data: suppliersData } = await supabase
        .from('users')
        .select('id, name, company, email')
        .in('id', upstreamSupplierIds);
      suppliersById = new Map((suppliersData || []).map((supplier) => [supplier.id, supplier]));
    }

    const supplierAgg = new Map();
    for (const order of ordersList) {
      const upstreamSupplierId = order.supplier_id || 'unknown';
      if (!supplierAgg.has(upstreamSupplierId)) {
        const supplier = suppliersById.get(upstreamSupplierId) || {};
        supplierAgg.set(upstreamSupplierId, {
          supplierId: upstreamSupplierId,
          name: supplier.name || supplier.company || 'Unknown Supplier',
          company: supplier.company || null,
          email: supplier.email || null,
          totalOrders: 0,
          paidOrders: 0,
          totalPurchaseValue: 0,
          paidPurchaseValue: 0,
          lastOrderAt: null
        });
      }

      const rec = supplierAgg.get(upstreamSupplierId);
      const orderValue = parseFloat(order.total_amount || 0) || 0;
      rec.totalOrders += 1;
      rec.totalPurchaseValue += orderValue;

      if (String(order.payment_status || '').toLowerCase() === 'paid') {
        rec.paidOrders += 1;
        rec.paidPurchaseValue += orderValue;
      }

      const createdTs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const prevTs = rec.lastOrderAt ? new Date(rec.lastOrderAt).getTime() : 0;
      if (createdTs > prevTs) {
        rec.lastOrderAt = order.created_at || null;
      }
    }

    const suppliers = [...supplierAgg.values()].sort(
      (a, b) => b.totalPurchaseValue - a.totalPurchaseValue
    );
    const normalizedTop = Number.isFinite(top) && top > 0 ? Math.min(top, 500) : null;
    const suppliersSlice = normalizedTop ? suppliers.slice(0, normalizedTop) : suppliers;

    return res.json({
      status: 'success',
      summary: {
        totalSuppliers: suppliersSlice.length,
        totalOrders: suppliersSlice.reduce((sum, supplier) => sum + supplier.totalOrders, 0),
        totalPurchaseValue: suppliersSlice.reduce(
          (sum, supplier) => sum + supplier.totalPurchaseValue,
          0
        ),
        paidPurchaseValue: suppliersSlice.reduce(
          (sum, supplier) => sum + supplier.paidPurchaseValue,
          0
        )
      },
      suppliers: suppliersSlice
    });
  } catch (error) {
    console.error('Supplier upstream purchase totals analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Buyer-wise purchase tracking for supplier portal.
router.get('/analytics/buyer-purchases', authenticateToken, async (req, res) => {
  try {
    const supplierId = req.userId;
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const top = parseInt(req.query?.top, 10);

    let ordersQuery = supabase
      .from('orders')
      .select('id, service_provider_id, total_amount, status, payment_status, created_at')
      .eq('supplier_id', supplierId);

    if (from) {
      ordersQuery = ordersQuery.gte('created_at', from);
    }
    if (to) {
      ordersQuery = ordersQuery.lte('created_at', to);
    }

    const { data: orders, error: ordersError } = await ordersQuery.order('created_at', { ascending: false });

    if (ordersError) {
      throw ordersError;
    }

    const ordersList = orders || [];
    if (ordersList.length === 0) {
      return res.json({
        status: 'success',
        summary: {
          totalBuyers: 0,
          totalOrders: 0,
          totalOrderValue: 0,
          totalNetRevenue: 0
        },
        buyers: []
      });
    }

    const recognizedOrders = ordersList.filter((order) => isRevenueRecognizedOrder(order));
    const recognizedOrderIds = recognizedOrders.map((order) => order.id).filter(Boolean);

    let orderNetRevenueById = new Map();
    if (recognizedOrderIds.length > 0) {
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('id, order_id, quantity, unit_price, total_price')
        .in('order_id', recognizedOrderIds);

      if (itemsError) {
        throw itemsError;
      }

      const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
        supabase,
        recognizedOrderIds
      );
      orderNetRevenueById = buildOrderNetRevenueMap(orderItems || [], closedReturnedQtyByOrderItem);
    }

    const buyerIds = [
      ...new Set(ordersList.map((order) => order.service_provider_id).filter(Boolean))
    ];
    let buyersById = new Map();
    if (buyerIds.length > 0) {
      const { data: buyersData } = await supabase
        .from('users')
        .select('id, name, company, email')
        .in('id', buyerIds);
      buyersById = new Map((buyersData || []).map((buyer) => [buyer.id, buyer]));
    }

    const buyerAgg = new Map();
    for (const order of ordersList) {
      const buyerId = order.service_provider_id || 'unknown';
      if (!buyerAgg.has(buyerId)) {
        const buyer = buyersById.get(buyerId) || {};
        buyerAgg.set(buyerId, {
          buyerId,
          name: buyer.name || buyer.company || 'Unknown Buyer',
          company: buyer.company || null,
          email: buyer.email || null,
          totalOrders: 0,
          paidOrders: 0,
          totalOrderValue: 0,
          netRevenue: 0,
          lastOrderAt: null
        });
      }

      const rec = buyerAgg.get(buyerId);
      rec.totalOrders += 1;
      rec.totalOrderValue += parseFloat(order.total_amount || 0) || 0;

      if (isRevenueRecognizedOrder(order)) {
        rec.paidOrders += 1;
        rec.netRevenue += orderNetRevenueById.get(order.id) || 0;
      }

      const createdTs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const prevTs = rec.lastOrderAt ? new Date(rec.lastOrderAt).getTime() : 0;
      if (createdTs > prevTs) {
        rec.lastOrderAt = order.created_at || null;
      }
    }

    const buyers = [...buyerAgg.values()].sort((a, b) => b.totalOrderValue - a.totalOrderValue);
    const normalizedTop = Number.isFinite(top) && top > 0 ? Math.min(top, 500) : null;
    const buyersSlice = normalizedTop ? buyers.slice(0, normalizedTop) : buyers;
    const summary = {
      totalBuyers: buyersSlice.length,
      totalOrders: ordersList.length,
      totalOrderValue: buyersSlice.reduce((sum, buyer) => sum + buyer.totalOrderValue, 0),
      totalNetRevenue: buyersSlice.reduce((sum, buyer) => sum + buyer.netRevenue, 0)
    };

    return res.json({
      status: 'success',
      summary,
      buyers: buyersSlice
    });
  } catch (error) {
    console.error('Supplier buyer purchases analytics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get single order details
}
