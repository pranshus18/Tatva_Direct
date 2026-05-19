import { fetchClosedReturnQuantityByOrderItem, getNetItemMetrics } from '../../utils/netRevenue.js';

export { fetchClosedReturnQuantityByOrderItem, getNetItemMetrics };

export async function generateAdminData({ supabase, console, isRevenueRecognizedOrder }) {
  try {
    // Get all users
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, name, email, company, user_type, created_at, is_active');
    
    const serviceProviders = (allUsers || []).filter(u => u.user_type === 'service_provider');
    // Filter out "Naina Mahajan" from suppliers
    const suppliers = (allUsers || []).filter(u => 
      u.user_type === 'supplier' && 
      u.name?.toLowerCase() !== 'naina mahajan'
    );

    // Get all products
    const { data: products } = await supabase
      .from('products')
      .select('*');
    
    // Debug: Log product counts and supplier associations
    console.log(`[ADMIN DATA] Total products found: ${(products || []).length}`);
    console.log(`[ADMIN DATA] Total suppliers found: ${suppliers.length}`);
    
    if (products && products.length > 0) {
      const productsWithSupplier = products.filter(p => p.supplier_id).length;
      console.log(`[ADMIN DATA] Products with supplier field: ${productsWithSupplier}`);
      
      // Get all unique supplier IDs from products
      const supplierIdsFromProducts = [...new Set(products.filter(p => p.supplier_id).map(p => p.supplier_id))];
      console.log(`[ADMIN DATA] Unique supplier IDs from products: ${supplierIdsFromProducts.length}`);
      console.log(`[ADMIN DATA] Supplier IDs from products:`, supplierIdsFromProducts.slice(0, 5));
      
      // Get all supplier IDs
      const supplierIds = suppliers.map(s => s.id);
      console.log(`[ADMIN DATA] Supplier IDs from users:`, supplierIds.slice(0, 5));
      
      // Check for mismatches
      const missingSuppliers = supplierIdsFromProducts.filter(id => !supplierIds.includes(id));
      if (missingSuppliers.length > 0) {
        console.log(`[ADMIN DATA] Products reference suppliers not in supplier list:`, missingSuppliers);
      }
      
      // Log sample products with their suppliers
      products.slice(0, 10).forEach((p, idx) => {
        const supplierId = p.supplier_id || 'NO SUPPLIER';
        const supplierName = suppliers.find(s => s.id === supplierId)?.name || 'UNKNOWN';
        console.log(`[ADMIN DATA] Product ${idx + 1}: "${p.name}" - supplier ID: ${supplierId} (${supplierName})`);
      });
      
      // Count products per supplier
      console.log(`\n[ADMIN DATA] Products per supplier breakdown:`);
      suppliers.forEach(supplier => {
        const count = products.filter(p => p.supplier_id === supplier.id).length;
        console.log(`[ADMIN DATA]   - ${supplier.name}: ${count} products`);
      });
      console.log(`\n`);
    }
    
    // Get all BOQs
    const { data: boqs } = await supabase
      .from('boqs')
      .select('*');
    
    // Get all orders with related data
    // Try using inferred relationships first (Supabase auto-detects foreign keys)
    let { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        *,
        service_provider:users(id, name, company, email),
        supplier:users(id, name, company, email),
        boq:boqs(id, name, description)
      `);
    
    // If that fails, try with explicit constraint names
    if (ordersError || !orders || orders.length === 0) {
      console.log('Trying alternative join syntax for orders...');
      const { data: ordersAlt, error: ordersAltError } = await supabase
        .from('orders')
        .select(`
          *,
          service_provider:users!orders_service_provider_id_fkey (id, name, company, email),
          supplier:users!orders_supplier_id_fkey (id, name, company, email),
          boq:boqs!orders_boq_id_fkey (id, name, description)
        `);
      
      if (!ordersAltError && ordersAlt) {
        orders = ordersAlt;
        ordersError = null;
      } else {
        console.error('Orders query error:', ordersAltError || ordersError);
      }
    }
    
    // Get order items with products
    let { data: allOrderItems, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        *,
        product:products(id, name, category)
      `);
    
    // If that fails, try with explicit constraint name
    if (itemsError || !allOrderItems) {
      console.log('Trying alternative join syntax for order_items...');
      const { data: itemsAlt, error: itemsAltError } = await supabase
        .from('order_items')
        .select(`
          *,
          product:products!order_items_product_id_fkey (id, name, category)
        `);
      
      if (!itemsAltError && itemsAlt) {
        allOrderItems = itemsAlt;
        itemsError = null;
      } else {
        console.error('Order items query error:', itemsAltError || itemsError);
      }
    }
    
    // If joins still fail, fetch users separately and join manually
    if ((ordersError || !orders || orders.some(o => !o.service_provider && !o.supplier)) && orders && orders.length > 0) {
      console.log('Joining users manually...');
      const serviceProviderIds = [...new Set(orders.map(o => o.service_provider_id).filter(Boolean))];
      const supplierIds = [...new Set(orders.map(o => o.supplier_id).filter(Boolean))];
      const allUserIds = [...new Set([...serviceProviderIds, ...supplierIds])];
      
      if (allUserIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name, company, email')
          .in('id', allUserIds);
        
        if (users) {
          const usersMap = {};
          users.forEach(u => { usersMap[u.id] = u; });
          
          orders = orders.map(order => ({
            ...order,
            service_provider: order.service_provider_id ? usersMap[order.service_provider_id] : null,
            supplier: order.supplier_id ? usersMap[order.supplier_id] : null
          }));
        }
      }
    }
    
    // If product joins fail, fetch products separately and join manually
    if ((itemsError || !allOrderItems || allOrderItems.some(item => !item.product)) && allOrderItems && allOrderItems.length > 0) {
      console.log('Joining products manually...');
      const productIds = [...new Set(allOrderItems.map(item => item.product_id).filter(Boolean))];
      
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, category')
          .in('id', productIds);
        
        if (products) {
          const productsMap = {};
          products.forEach(p => { productsMap[p.id] = p; });
          
          allOrderItems = allOrderItems.map(item => ({
            ...item,
            product: item.product_id ? productsMap[item.product_id] : null
          }));
        }
      }
    }
    
    // Group items by order_id
    const itemsByOrder = {};
    (allOrderItems || []).forEach(item => {
      if (!itemsByOrder[item.order_id]) {
        itemsByOrder[item.order_id] = [];
      }
      itemsByOrder[item.order_id].push(item);
    });
    
    // Attach items to orders
    const ordersWithItems = (orders || []).map(order => ({
      ...order,
      items: itemsByOrder[order.id] || []
    }));

    // Fetch all supplier ratings once (used to compute per-supplier averages)
    const { data: allSupplierRatings } = await supabase
      .from('supplier_ratings')
      .select('id, supplier_id, rating');

    // Fetch supplier inventory/offers once (used for inventory value and supplier product lists)
    const { data: allSupplierProducts } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, price, stock, location, status, is_active, min_order_quantity, attributes');

    const supplierInventoryValueById = {};
    let totalInventoryValueAll = 0;
    for (const row of allSupplierProducts || []) {
      const supplierId = row?.supplier_id;
      if (!supplierId) continue;
      const qty = parseInt(row.stock) || 0;
      const price = parseFloat(row.price) || 0;
      const value = qty * price;
      totalInventoryValueAll += value;
      supplierInventoryValueById[supplierId] = (supplierInventoryValueById[supplierId] || 0) + value;
    }

    const productsById = new Map((products || []).map((p) => [p.id, p]));

    const recognizedOrdersForRevenue = (ordersWithItems || []).filter((o) =>
      isRevenueRecognizedOrder(o)
    );
    const recognizedOrderIdsForRevenue = recognizedOrdersForRevenue.map((o) => o.id).filter(Boolean);
    const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
      supabase,
      recognizedOrderIdsForRevenue
    );

    const netRevenueByOrderId = new Map();
    for (const order of recognizedOrdersForRevenue) {
      const normalizedItems = (order.items || order.order_items || []).map((item) => ({
        ...item,
        order_id: order.id
      }));
      const netOrderRevenue = normalizedItems.reduce(
        (sum, item) => sum + getNetItemMetrics(item, closedReturnedQtyByOrderItem).netRevenue,
        0
      );
      netRevenueByOrderId.set(order.id, netOrderRevenue);
    }

    // Generate supplier data with their products and orders
    const supplierData = await Promise.all(suppliers.map(async (supplier) => {
      const supplierId = supplier.id;
      
      // Get catalog products for this supplier (legacy - supplier_id on products)
      const catalogProducts = (products || []).filter(p => p.supplier_id === supplierId);
      const supplierOffers = (allSupplierProducts || []).filter((sp) => sp.supplier_id === supplierId);

      const normalizedSupplierProducts = supplierOffers.map((offer) => {
        const base = productsById.get(offer.product_id) || {};
        const attrs = offer.attributes || {};
        const specs = (attrs.specifications && typeof attrs.specifications === 'object')
          ? attrs.specifications
          : (base.specifications || {});

        return {
          ...base,
          id: offer.id,
          supplier_product_id: offer.id,
          product_id: offer.product_id,
          name: (attrs.listingName && String(attrs.listingName).trim()) || base.name || 'Unnamed Product',
          brand: attrs.brand || base.brand || attrs.brandModel || specs.brandModel || specs.brand || '',
          category: base.category || '',
          unit: attrs.unit || base.unit || 'nos',
          price: Number.isFinite(parseFloat(offer.price)) ? parseFloat(offer.price) : 0,
          stock: Number.isFinite(parseInt(offer.stock, 10)) ? parseInt(offer.stock, 10) : 0,
          location: offer.location || base.location || '',
          status: offer.status || base.status || 'pending',
          is_active: offer.is_active,
          min_order_quantity: offer.min_order_quantity || base.min_order_quantity || 1,
          specifications: specs
        };
      });

      const supplierProductsForAdmin = normalizedSupplierProducts.length > 0
        ? normalizedSupplierProducts
        : catalogProducts;
      
      console.log(`[ADMIN DATA] Supplier "${supplier.name}" (ID: ${supplierId})`);
      console.log(`[ADMIN DATA]   - Catalog products (legacy): ${catalogProducts.length}`);
      console.log(`[ADMIN DATA]   - Supplier offers: ${supplierOffers.length}`);
      
      // Get orders for this supplier
      const supplierOrders = (ordersWithItems || []).filter(o => 
        o.supplier_id === supplierId
      );
      
      // Inventory value should be based on supplier_products (per-supplier, per-location),
      // not on legacy products.price/stock.
      const totalInventoryValue = supplierInventoryValueById[supplierId] || 0;
      const totalRevenue = supplierOrders
        .filter((o) => isRevenueRecognizedOrder(o))
        .reduce((sum, o) => sum + (netRevenueByOrderId.get(o.id) || 0), 0);
      
      // Get service providers this supplier has worked with
      const serviceProviderIds = [...new Set(supplierOrders.map(o => o.service_provider_id).filter(Boolean))];
      const serviceProvidersWorkedWith = serviceProviderIds.length;

      // Supplier rating summary (from supplier_ratings table)
      const supplierRatings = (allSupplierRatings || []).filter(r => r.supplier_id === supplierId);
      const totalReviews = supplierRatings.length;
      const averageRating = totalReviews > 0
        ? supplierRatings.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0) / totalReviews
        : 0;
      
      return {
        ...supplier,
        products: supplierProductsForAdmin,
        orders: supplierOrders.map(order => ({
          orderNumber: order.order_number,
          serviceProvider: order.service_provider ? {
            name: order.service_provider.name,
            company: order.service_provider.company,
            email: order.service_provider.email
          } : null,
          totalAmount: parseFloat(order.total_amount) || 0,
          status: order.status,
          createdAt: order.created_at,
          items: order.items?.length || 0
        })),
        totalProducts: supplierProductsForAdmin.length,
        totalInventoryValue: totalInventoryValue,
        totalRevenue: totalRevenue,
        activeOrders: supplierOrders.filter((o) => o.status !== 'cancelled' && !isRevenueRecognizedOrder(o)).length,
        completedOrders: supplierOrders.filter((o) => isRevenueRecognizedOrder(o)).length,
        categories: [...new Set(supplierProductsForAdmin.map(p => p.category).filter(Boolean))],
        serviceProvidersWorkedWith: serviceProvidersWorkedWith,
        averageOrderValue: supplierOrders.length > 0 ? totalRevenue / supplierOrders.length : 0,
        averageRating,
        totalReviews
      };
    }));

    // Generate service provider data with their BOQs and orders
    const allServiceProviderData = await Promise.all(serviceProviders.map(async (sp) => {
      const spBOQs = (boqs || []).filter(boq => 
        boq.service_provider_id === sp.id
      );
      const spOrders = (ordersWithItems || []).filter(o => 
        o.service_provider_id === sp.id
      );
      const totalBOQValue = spBOQs.reduce((sum, boq) => sum + (parseFloat(boq.total_value) || 0), 0);
      const totalSpent = spOrders
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
      
      // Get suppliers this service provider has worked with
      const supplierIds = [...new Set(spOrders.map(o => o.supplier_id).filter(Boolean))];
      const suppliersWorkedWith = supplierIds.length;
      
      // Get BOQ items count
      const { data: boqItems } = await supabase
        .from('boq_items')
        .select('boq_id')
        .in('boq_id', spBOQs.map(b => b.id));
      
      const boqItemsCount = {};
      (boqItems || []).forEach(item => {
        boqItemsCount[item.boq_id] = (boqItemsCount[item.boq_id] || 0) + 1;
      });
      
      return {
        ...sp,
        boqs: spBOQs.map(boq => ({
          name: boq.name,
          description: boq.description,
          itemCount: boqItemsCount[boq.id] || 0,
          totalValue: parseFloat(boq.total_value) || 0,
          status: boq.status,
          createdAt: boq.created_at
        })),
        orders: spOrders.map(order => ({
          orderNumber: order.order_number,
          supplier: order.supplier ? {
            name: order.supplier.name,
            company: order.supplier.company,
            email: order.supplier.email
          } : null,
          totalAmount: parseFloat(order.total_amount) || 0,
          status: order.status,
          createdAt: order.created_at,
          items: order.items?.length || 0
        })),
        totalBOQs: spBOQs.length,
        totalBOQValue: totalBOQValue,
        totalSpent: totalSpent,
        activeOrders: spOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length,
        completedOrders: spOrders.filter(o => o.status === 'delivered').length,
        activeBOQs: spBOQs.filter(boq => boq.status !== 'completed').length,
        suppliersWorkedWith: suppliersWorkedWith,
        averageOrderValue: spOrders.length > 0 ? totalSpent / spOrders.length : 0
      };
    }));
    
    // Filter out service providers with no activity (0 BOQs, 0 orders, ₹0 spent)
    const serviceProviderData = allServiceProviderData.filter(sp => {
      const hasBOQs = (sp.totalBOQs || 0) > 0;
      const hasOrders = (sp.orders?.length || 0) > 0;
      const hasSpent = (sp.totalSpent || 0) > 0;
      return hasBOQs || hasOrders || hasSpent;
    });

    // Generate transactions from actual orders with populated information
    const transactions = (ordersWithItems || []).map(order => {
      const itemCount = order.items ? order.items.length : 0;
      const productNames = order.items && order.items.length > 0
        ? order.items.slice(0, 3).map(item => {
            // Try to get product name if populated
            if (item.product && typeof item.product === 'object' && item.product.name) {
              return item.product.name;
            }
            return 'Product';
          }).join(', ') + (itemCount > 3 ? ` +${itemCount - 3} more` : '')
        : 'No items';
      
      // Debug logging for missing data
      if (!order.service_provider && order.service_provider_id) {
        console.log(`[ADMIN DATA] Order ${order.order_number} has service_provider_id but no service_provider data:`, order.service_provider_id);
      }
      if (!order.supplier && order.supplier_id) {
        console.log(`[ADMIN DATA] Order ${order.order_number} has supplier_id but no supplier data:`, order.supplier_id);
      }
      if (order.items && order.items.length > 0 && order.items.some(item => !item.product && item.product_id)) {
        console.log(`[ADMIN DATA] Order ${order.order_number} has order_items with product_id but no product data`);
      }
      
      return {
        id: order.order_number || order.id,
        orderId: order.id,
        type: 'order',
        serviceProvider: order.service_provider ? {
          name: order.service_provider.name || '',
          company: order.service_provider.company || '',
          email: order.service_provider.email || ''
        } : null,
        supplier: order.supplier ? {
          name: order.supplier.name || '',
          company: order.supplier.company || '',
          email: order.supplier.email || ''
        } : null,
        boq: order.boq ? {
          name: order.boq.name || '',
          description: order.boq.description || ''
        } : null,
        amount: parseFloat(order.total_amount) || 0,
        date: order.created_at ? new Date(order.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        createdAt: order.created_at || new Date().toISOString(),
        status: order.status || 'pending',
        paymentStatus: order.payment_status || 'pending',
        products: productNames,
        productCount: itemCount,
        items: order.items?.map(item => ({
          product: (item.product && typeof item.product === 'object' && item.product.name) ? item.product.name : 'Product',
          quantity: parseFloat(item.quantity) || 0,
          unitPrice: parseFloat(item.unit_price) || 0,
          totalPrice: parseFloat(item.total_price) || 0
        })) || []
      };
    });

    // Sort transactions by date (newest first)
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Keep dashboard stats and transaction list on the same recognized set:
    // paid transactions across online/offline channels.
    const recognizedTransactions = transactions
      .filter((t) => isRevenueRecognizedOrder(t))
      .map((t) => ({
        ...t,
        amount: netRevenueByOrderId.get(t.orderId) ?? t.amount
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate total revenue from recognized transactions only.
    const totalRevenue = recognizedTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Generate user list with proper formatting (excluding Naina Mahajan)
    const userList = (allUsers || [])
      .filter(user => user.name?.toLowerCase() !== 'naina mahajan')
      .map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company || 'Individual',
        userType: user.user_type || 'general',
        joinedDate: user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown',
        status: user.is_active ? 'active' : 'inactive'
      }));

    return {
      stats: {
        totalUsers: (allUsers || []).length,
        serviceProviders: serviceProviderData.length, // Only count service providers with activity
        suppliers: suppliers.length,
        totalTransactions: recognizedTransactions.length,
        totalRevenue: totalRevenue,
        activeBOQs: (boqs || []).filter(boq => boq.status !== 'completed').length,
        totalProducts: (products || []).length,
        totalInventoryValue: totalInventoryValueAll,
        activeOrders: (ordersWithItems || []).filter((o) => o.status !== 'cancelled' && !isRevenueRecognizedOrder(o)).length,
        totalBOQs: (boqs || []).length
      },
      users: userList,
      transactions: recognizedTransactions,
      supplierData: supplierData,
      serviceProviderData: serviceProviderData,
      products: products || [],
      boqs: boqs || [],
      orders: ordersWithItems || []
    };
  } catch (error) {
    console.error('Error generating admin data:', error);
    throw error;
  }
};
