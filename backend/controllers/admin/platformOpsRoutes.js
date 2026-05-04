export function registerAdminPlatformOpsRoutes({
  router,
  authenticateToken,
  isAdmin,
  supabase,
  generateAdminData,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
}) {
  // Diagnostic endpoint to check products and suppliers
  router.get('/diagnostics/products-suppliers', authenticateToken, isAdmin, async (req, res) => {
    try {
      // Get all suppliers
      const { data: suppliers } = await supabase
        .from('users')
        .select('id, name, email, company')
        .eq('user_type', 'supplier');

      // Get all products
      const { data: products } = await supabase
        .from('products')
        .select('id, name, supplier_id');

      // Group products by supplier
      const supplierProductMap = {};
      (suppliers || []).forEach(supplier => {
        supplierProductMap[supplier.id] = {
          supplier: {
            id: supplier.id,
            name: supplier.name,
            email: supplier.email,
            company: supplier.company
          },
          products: []
        };
      });

      // Map products to suppliers
      (products || []).forEach(product => {
        if (product.supplier_id) {
          const supplierId = product.supplier_id;
          if (supplierProductMap[supplierId]) {
            supplierProductMap[supplierId].products.push({
              id: product.id,
              name: product.name
            });
          } else {
            // Product has supplier ID that doesn't exist in suppliers list
            if (!supplierProductMap['_orphaned']) {
              supplierProductMap['_orphaned'] = {
                supplier: { id: 'ORPHANED', name: 'Orphaned Products', email: '', company: '' },
                products: []
              };
            }
            supplierProductMap['_orphaned'].products.push({
              id: product.id,
              name: product.name,
              supplierId: supplierId
            });
          }
        } else {
          // Product has no supplier
          if (!supplierProductMap['_no_supplier']) {
            supplierProductMap['_no_supplier'] = {
              supplier: { id: 'NO_SUPPLIER', name: 'Products Without Supplier', email: '', company: '' },
              products: []
            };
          }
          supplierProductMap['_no_supplier'].products.push({
            id: product.id,
            name: product.name
          });
        }
      });

      const result = Object.values(supplierProductMap);

      res.json({
        status: 'success',
        totalSuppliers: (suppliers || []).length,
        totalProducts: (products || []).length,
        suppliersWithProducts: result.filter(s => s.products.length > 0 && !s.supplier.id.startsWith('_')).length,
        data: result
      });
    } catch (error) {
      console.error('Diagnostics error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  });

  // Test endpoint to verify admin routes are working
  router.get('/test', authenticateToken, isAdmin, async (req, res) => {
    try {
      res.json({
        status: 'success',
        message: 'Admin route is working correctly',
        userId: req.userId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Admin test error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Test endpoint error',
        error: error.message
      });
    }
  });

  // Diagnostic endpoint to check products
  router.get('/products/debug', authenticateToken, isAdmin, async (req, res) => {
    try {
      // Get counts
      const { count: totalProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

      const { count: pendingProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: approvedProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      const { count: rejectedProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected');

      const { count: nullStatusProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .or('status.is.null,status.eq.');

      // Get sample products
      const { data: sampleProducts } = await supabase
        .from('products')
        .select('name, status, supplier_id, created_at')
        .limit(5);

      res.json({
        status: 'success',
        counts: {
          total: totalProducts || 0,
          pending: pendingProducts || 0,
          approved: approvedProducts || 0,
          rejected: rejectedProducts || 0,
          nullOrEmpty: nullStatusProducts || 0
        },
        sampleProducts: (sampleProducts || []).map(p => ({
          name: p.name,
          status: p.status,
          supplier: p.supplier_id,
          createdAt: p.created_at
        }))
      });
    } catch (error) {
      console.error('Products debug error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Debug endpoint error',
        error: error.message
      });
    }
  });

  // Inventory summary across all suppliers and outlets
  router.get('/inventory/summary', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { data: rows, error } = await supabase
        .from('supplier_products')
        .select(`
        id,
        price,
        stock,
        status,
        is_active,
        supplier_id,
        outlet_id,
        product:products (id, name, category, unit),
        outlet:outlets (id, name, code),
        supplier:users!supplier_products_supplier_id_fkey (id, name, company)
      `);

      if (error) {
        throw error;
      }

      const items = rows || [];

      let totalStockQty = 0;
      let totalStockValue = 0;

      const suppliersMap = {};
      const outletsMap = {};

      for (const row of items) {
        const qty = parseInt(row.stock) || 0;
        const price = parseFloat(row.price) || 0;
        const value = qty * price;

        totalStockQty += qty;
        totalStockValue += value;

        // Group by supplier
        const supplier = row.supplier || {};
        const supplierId = supplier.id || row.supplier_id || 'unknown';
        if (!suppliersMap[supplierId]) {
          suppliersMap[supplierId] = {
            supplierId,
            supplierName: supplier.name || supplier.company || 'Unknown Supplier',
            totalStockQty: 0,
            totalStockValue: 0,
            productCount: 0
          };
        }
        suppliersMap[supplierId].totalStockQty += qty;
        suppliersMap[supplierId].totalStockValue += value;
        suppliersMap[supplierId].productCount += 1;

        // Group by outlet
        const outlet = row.outlet || {};
        const outletKey = row.outlet_id || 'unassigned';
        if (!outletsMap[outletKey]) {
          outletsMap[outletKey] = {
            outletId: outlet.id || null,
            outletCode: outlet.code || null,
            outletName: outlet.name || (outletKey === 'unassigned' ? 'Unassigned' : 'Outlet'),
            totalStockQty: 0,
            totalStockValue: 0,
            productCount: 0
          };
        }
        outletsMap[outletKey].totalStockQty += qty;
        outletsMap[outletKey].totalStockValue += value;
        outletsMap[outletKey].productCount += 1;
      }

      res.json({
        status: 'success',
        summary: {
          totalStockQty,
          totalStockValue,
          supplierCount: Object.keys(suppliersMap).length,
          outletCount: Object.keys(outletsMap).length
        },
        suppliers: Object.values(suppliersMap),
        outlets: Object.values(outletsMap)
      });
    } catch (error) {
      console.error('Admin inventory summary error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Sales by channel analytics across platform
  router.get('/analytics/sales-by-channel', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { from, to } = req.query;

      // 1) Fetch all orders (optionally date filtered)
      let ordersQuery = supabase
        .from('orders')
        .select('id, channel, supplier_id, total_amount, created_at, status, payment_status');

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

      // Keep analytics aligned with admin "Platform Revenue":
      // revenue is recognized for all paid orders across channels.
      const recognizedOrders = (orders || []).filter((o) => isRevenueRecognizedOrder(o));
      const orderIds = recognizedOrders.map(o => o.id);
      if (orderIds.length === 0) {
        return res.json({
          status: 'success',
          summary: {
            totalRevenue: 0,
            totalOrders: 0,
            channels: []
          },
          products: [],
          suppliers: []
        });
      }

      // 2) Fetch order_items for these orders
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('id, order_id, product_id, quantity, unit_price, total_price')
        .in('order_id', orderIds);

      if (itemsError) {
        throw itemsError;
      }

      const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
        supabase,
        orderIds
      );

      // 3) Fetch product and supplier names for reporting
      const productIds = [...new Set((orderItems || []).map(i => i.product_id).filter(Boolean))];
      let productsMap = {};
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, category')
          .in('id', productIds);
        (products || []).forEach(p => { productsMap[p.id] = p; });
      }

      const supplierIds = [...new Set(recognizedOrders.map(o => o.supplier_id).filter(Boolean))];
      let suppliersMap = {};
      if (supplierIds.length > 0) {
        const { data: suppliers } = await supabase
          .from('users')
          .select('id, name, company')
          .in('id', supplierIds);
        (suppliers || []).forEach(s => { suppliersMap[s.id] = s; });
      }

      const ordersById = {};
      recognizedOrders.forEach(o => { ordersById[o.id] = o; });

      // 4) Aggregate by channel, product, supplier
      const channelAgg = {};
      const channelOrderSet = {}; // Track unique orders per channel
      const productAgg = {};
      const supplierAgg = {};
      let totalRevenue = 0;

      (orderItems || []).forEach(item => {
        const order = ordersById[item.order_id];
        if (!order) return;
        const channel = order.channel || 'unknown';
        const supplierId = order.supplier_id || 'unknown';

        const metrics = getNetItemMetrics(item, closedReturnedQtyByOrderItem);
        const qty = metrics.netQty;
        const revenue = metrics.netRevenue;
        if (qty <= 0 || revenue <= 0) return;

        totalRevenue += revenue;

        // Channel-level
        if (!channelAgg[channel]) {
          channelAgg[channel] = { channel, revenue: 0, quantity: 0, totalOrders: 0 };
          channelOrderSet[channel] = new Set();
        }
        channelAgg[channel].revenue += revenue;
        channelAgg[channel].quantity += qty;
        // Track unique orders
        if (!channelOrderSet[channel].has(order.id)) {
          channelOrderSet[channel].add(order.id);
          channelAgg[channel].totalOrders += 1;
        }

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
        const pRec = productAgg[pid];
        const isOffline = channel === 'offline_sale';
        pRec.totalQty += qty;
        pRec.totalRevenue += revenue;
        if (isOffline) {
          pRec.offlineQty += qty;
          pRec.offlineRevenue += revenue;
        } else {
          pRec.onlineQty += qty;
          pRec.onlineRevenue += revenue;
        }

        // Supplier-level
        if (!supplierAgg[supplierId]) {
          const s = suppliersMap[supplierId] || {};
          supplierAgg[supplierId] = {
            supplierId,
            name: s.name || s.company || 'Unknown Supplier',
            onlineQty: 0,
            offlineQty: 0,
            onlineRevenue: 0,
            offlineRevenue: 0,
            totalQty: 0,
            totalRevenue: 0
          };
        }
        const sRec = supplierAgg[supplierId];
        sRec.totalQty += qty;
        sRec.totalRevenue += revenue;
        if (isOffline) {
          sRec.offlineQty += qty;
          sRec.offlineRevenue += revenue;
        } else {
          sRec.onlineQty += qty;
          sRec.onlineRevenue += revenue;
        }
      });

      // Convert channel aggregation to array format with proper field names
      const channels = Object.values(channelAgg).map(ch => ({
        channel: ch.channel,
        totalOrders: ch.totalOrders,
        totalRevenue: ch.revenue
      }));
      const products = Object.values(productAgg)
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, 50);
      const suppliers = Object.values(supplierAgg)
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, 50);

      res.json({
        status: 'success',
        summary: {
          totalRevenue,
          totalOrders: recognizedOrders.length,
          channels
        },
        products,
        suppliers
      });
    } catch (error) {
      console.error('Admin sales-by-channel analytics error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Admin dashboard data
  router.get('/dashboard', authenticateToken, isAdmin, async (req, res) => {
    try {
      const adminData = await generateAdminData();
      res.json({
        status: 'success',
        data: adminData
      });
    } catch (error) {
      console.error('Admin dashboard error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
