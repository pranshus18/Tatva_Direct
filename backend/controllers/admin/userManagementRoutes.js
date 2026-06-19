import { adminUserStatusUpdateSchema } from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { formatPlatformDate } from '../../utils/dateTime.js';

export function registerAdminUserManagementRoutes({
  router,
  authenticateToken,
  isAdmin,
  supabase,
  db,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
}) {
  const isValidUuid = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

  // Get all users (admin only)
  router.get('/users', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email, company, user_type, created_at, is_active');

      const userList = (users || []).map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company || 'Individual',
        userType: user.user_type || 'general',
        joinedDate: user.created_at ? formatPlatformDate(user.created_at, 'Unknown') : 'Unknown',
        status: user.is_active ? 'active' : 'inactive'
      }));

      res.json({
        status: 'success',
        users: userList
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Get user details (admin only)
  router.get('/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid user id'
        });
      }
      const user = await db.findById('users', req.params.id, 'id, name, email, company, user_type, phone, address, profile, is_active, created_at, updated_at');

      if (!user) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      res.json({
        status: 'success',
        user
      });
    } catch (error) {
      console.error('Get user details error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Get all transactions (admin only)
  router.get('/transactions', authenticateToken, isAdmin, async (req, res) => {
    try {
      // Get orders with all related data - try inferred relationships first
      let { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
        *,
        service_provider:users(id, name, company, email),
        supplier:users(id, name, company, email),
        boq:boqs(id, name, description)
      `)
        .order('created_at', { ascending: false });

      // If that fails, try with explicit constraint names
      if (ordersError || !orders || orders.length === 0) {
        console.log('Trying alternative join syntax for transactions orders...');
        const { data: ordersAlt, error: ordersAltError } = await supabase
          .from('orders')
          .select(`
          *,
          service_provider:users!orders_service_provider_id_fkey (id, name, company, email),
          supplier:users!orders_supplier_id_fkey (id, name, company, email),
          boq:boqs!orders_boq_id_fkey (id, name, description)
        `)
          .order('created_at', { ascending: false });

        if (!ordersAltError && ordersAlt) {
          orders = ordersAlt;
          ordersError = null;
        } else {
          console.error('Transactions orders query error:', ordersAltError || ordersError);
        }
      }

      // Get order items with products - try inferred relationship first
      let { data: allOrderItems, error: itemsError } = await supabase
        .from('order_items')
        .select(`
        *,
        product:products(id, name, category)
      `);

      // If that fails, try with explicit constraint name
      if (itemsError || !allOrderItems) {
        console.log('Trying alternative join syntax for transactions order_items...');
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
          console.error('Transactions order items query error:', itemsAltError || itemsError);
        }
      }

      // If joins still fail, fetch users separately and join manually
      if ((ordersError || !orders || orders.some(o => !o.service_provider && !o.supplier)) && orders && orders.length > 0) {
        console.log('Joining users manually for transactions...');
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
        console.log('Joining products manually for transactions...');
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

      const transactions = (orders || []).map(order => {
        const orderItems = itemsByOrder[order.id] || [];
        const itemCount = orderItems.length;
        const productNames = orderItems.length > 0
          ? orderItems.slice(0, 3).map(item => {
            if (item.product && typeof item.product === 'object') {
              return item.product.name || 'Product';
            }
            return 'Product';
          }).join(', ') + (itemCount > 3 ? ` +${itemCount - 3} more` : '')
          : 'No items';

        return {
          id: order.order_number || order.id,
          orderId: order.id,
          type: 'order',
          serviceProvider: order.service_provider ? {
            name: order.service_provider.name,
            company: order.service_provider.company,
            email: order.service_provider.email
          } : null,
          supplier: order.supplier ? {
            name: order.supplier.name,
            company: order.supplier.company,
            email: order.supplier.email
          } : null,
          boq: order.boq ? {
            name: order.boq.name,
            description: order.boq.description
          } : null,
          amount: parseFloat(order.total_amount) || 0,
          date: order.created_at ? new Date(order.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          createdAt: order.created_at,
          status: order.status,
          paymentStatus: order.payment_status,
          products: productNames,
          productCount: itemCount,
          items: orderItems.map(item => ({
            product: item.product?.name || 'Product',
            quantity: parseFloat(item.quantity) || 0,
            unitPrice: parseFloat(item.unit_price) || 0,
            totalPrice: parseFloat(item.total_price) || 0
          }))
        };
      });

      res.json({
        status: 'success',
        transactions
      });
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Get detailed supplier information (admin only)
  router.get('/suppliers/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid supplier id'
        });
      }
      const supplier = await db.findById('users', req.params.id);

      if (!supplier || supplier.user_type !== 'supplier') {
        return res.status(404).json({
          status: 'error',
          message: 'Supplier not found'
        });
      }

      // Remove password from response
      delete supplier.password;

      // Get products
      const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('supplier_id', req.params.id);

      // Get orders
      const { data: orders } = await supabase
        .from('orders')
        .select(`
        *,
        service_provider:users!orders_service_provider_id_fkey (id, name, company, email),
        items:order_items (
          *,
          product:products!order_items_product_id_fkey (id, name, category)
        )
      `)
        .eq('supplier_id', req.params.id)
        .order('created_at', { ascending: false });

      const recognizedOrderIds = (orders || [])
        .filter((o) => isRevenueRecognizedOrder(o))
        .map((o) => o.id)
        .filter(Boolean);
      const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
        supabase,
        recognizedOrderIds
      );

      const supplierData = {
        ...supplier,
        products: products || [],
        orders: orders || [],
        stats: {
          totalProducts: (products || []).length,
          totalOrders: (orders || []).length,
          totalRevenue: (orders || [])
            .filter((o) => isRevenueRecognizedOrder(o))
            .reduce((sum, o) => {
              const items = (o.items || []).map((item) => ({ ...item, order_id: o.id }));
              const orderNet = items.reduce(
                (itemSum, item) => itemSum + getNetItemMetrics(item, closedReturnedQtyByOrderItem).netRevenue,
                0
              );
              return sum + orderNet;
            }, 0),
          activeOrders: (orders || []).filter((o) => o.status !== 'cancelled' && !isRevenueRecognizedOrder(o)).length,
          totalInventoryValue: (products || []).reduce((sum, p) => sum + ((parseFloat(p.price) || 0) * (parseInt(p.stock) || 0)), 0)
        }
      };

      res.json({
        status: 'success',
        supplier: supplierData
      });
    } catch (error) {
      console.error('Get supplier details error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Get detailed ratings & feedback for a specific supplier (admin only)
  router.get('/suppliers/:id/ratings', authenticateToken, isAdmin, async (req, res) => {
    try {
      const supplierId = req.params.id;

      // Fetch ratings for this supplier
      const { data: ratings, error: ratingsError } = await supabase
        .from('supplier_ratings')
        .select('id, order_id, supplier_id, service_provider_id, rating, feedback, created_at')
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false });

      if (ratingsError) {
        throw ratingsError;
      }

      if (!ratings || ratings.length === 0) {
        return res.json({
          status: 'success',
          ratings: [],
          summary: {
            averageRating: 0,
            totalReviews: 0
          }
        });
      }

      const orderIds = [...new Set(ratings.map(r => r.order_id).filter(Boolean))];
      const spIds = [...new Set(ratings.map(r => r.service_provider_id).filter(Boolean))];

      // Fetch related orders
      let ordersById = {};
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, order_number, total_amount, status, created_at')
          .in('id', orderIds);

        (orders || []).forEach(o => {
          ordersById[o.id] = o;
        });
      }

      // Fetch related service providers
      let spsById = {};
      if (spIds.length > 0) {
        const { data: sps } = await supabase
          .from('users')
          .select('id, name, company, email')
          .in('id', spIds);

        (sps || []).forEach(sp => {
          spsById[sp.id] = sp;
        });
      }

      const detailedRatings = ratings.map(r => ({
        id: r.id,
        rating: r.rating,
        feedback: r.feedback,
        createdAt: r.created_at,
        order: ordersById[r.order_id] || null,
        serviceProvider: spsById[r.service_provider_id] || null
      }));

      const totalReviews = ratings.length;
      const averageRating = ratings.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0) / totalReviews;

      res.json({
        status: 'success',
        ratings: detailedRatings,
        summary: {
          averageRating,
          totalReviews
        }
      });
    } catch (error) {
      console.error('Get supplier ratings error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Get detailed service provider information (admin only)
  router.get('/service-providers/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid service provider id'
        });
      }
      const serviceProvider = await db.findById('users', req.params.id);

      if (!serviceProvider || serviceProvider.user_type !== 'service_provider') {
        return res.status(404).json({
          status: 'error',
          message: 'Service provider not found'
        });
      }

      // Remove password from response
      delete serviceProvider.password;

      // Get BOQs
      const { data: boqs } = await supabase
        .from('boqs')
        .select('*')
        .eq('service_provider_id', req.params.id)
        .order('created_at', { ascending: false });

      // Get orders
      const { data: orders } = await supabase
        .from('orders')
        .select(`
        *,
        supplier:users!orders_supplier_id_fkey (id, name, company, email),
        boq:boqs!orders_boq_id_fkey (id, name, description),
        items:order_items (
          *,
          product:products!order_items_product_id_fkey (id, name, category)
        )
      `)
        .eq('service_provider_id', req.params.id)
        .order('created_at', { ascending: false });

      const serviceProviderData = {
        ...serviceProvider,
        boqs: boqs || [],
        orders: orders || [],
        stats: {
          totalBOQs: (boqs || []).length,
          totalOrders: (orders || []).length,
          totalSpent: (orders || []).filter(o => o.status === 'delivered').reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0),
          activeOrders: (orders || []).filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length,
          activeBOQs: (boqs || []).filter(boq => boq.status !== 'completed').length,
          totalBOQValue: (boqs || []).reduce((sum, boq) => sum + (parseFloat(boq.total_value) || 0), 0)
        }
      };

      res.json({
        status: 'success',
        serviceProvider: serviceProviderData
      });
    } catch (error) {
      console.error('Get service provider details error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Update user status (admin only)
  router.put('/users/:id/status', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { status } = parseWithSchema(adminUserStatusUpdateSchema, req.body || {});
      const normalizedStatus = String(status || '').toLowerCase();
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid user id'
        });
      }
      if (!['active', 'inactive'].includes(normalizedStatus)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid status. Allowed values: active, inactive'
        });
      }
      const isActive = normalizedStatus === 'active';

      const user = await db.update('users', req.params.id, { is_active: isActive });

      if (!user) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      // Remove password from response
      delete user.password;

      res.json({
        status: 'success',
        message: 'User status updated successfully',
        user
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Update user status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
