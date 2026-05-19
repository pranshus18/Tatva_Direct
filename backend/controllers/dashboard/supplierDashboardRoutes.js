/** Dashboard routes: supplierDashboard */
import {
  fetchClosedReturnQuantityByOrderItem,
  formatDate,
  getNetItemMetrics,
  isRevenueRecognizedOrder
} from './dashboardImports.js';

export function registerDashboardSupplierDashboardRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/supplier', authenticateToken, async (req, res) => {
  try {
    // Get supplier's products from supplier_products junction table
    const { data: supplierProducts, error: productError } = await supabase
      .from('supplier_products')
      .select(`
        *,
        product:products(*)
      `)
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: false });

    if (productError) {
      console.error('Product fetch error:', productError);
      // Fallback: try old products table for backward compatibility
      const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false });
      
      const productsList = products || [];
      const ordersList = [];
      
      return res.json({
        status: 'success',
        stats: {
          totalProducts: productsList.length,
          activeOrders: 0,
          totalRevenue: 0,
          pendingQuotes: 0
        },
        products: productsList.slice(0, 10).map(product => ({
          id: product.id,
          name: product.name,
          category: product.category,
          price: parseFloat(product.price || 0),
          unit: product.unit,
          stock: product.stock,
          description: product.description
        })),
        orders: []
      });
    }
    
    // Get supplier's orders
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('supplier_id', req.userId)
      .order('created_at', { ascending: false });

    if (orderError) {
      console.error('Order fetch error:', orderError);
    }

    // Combine product and supplier_products data
    const productsList = (supplierProducts || []).map(sp => ({
      ...sp.product,
      price: sp.price,
      stock: sp.stock,
      location: sp.location,
      status: sp.status,
      is_active: sp.is_active
    })).filter(p => p.id); // Only include products that exist
    
    const ordersList = orders || [];

    const recognizedOrders = ordersList.filter((o) => isRevenueRecognizedOrder(o));
    const recognizedOrderIds = recognizedOrders.map((o) => o.id).filter(Boolean);
    const closedReturnedQtyByOrderItem = await fetchClosedReturnQuantityByOrderItem(
      supabase,
      recognizedOrderIds
    );

    const recognizedOrderItems = recognizedOrders.flatMap((order) =>
      (order.order_items || []).map((item) => ({ ...item, order_id: order.id }))
    );
    const netRecognizedRevenue = recognizedOrderItems.reduce(
      (sum, item) => sum + getNetItemMetrics(item, closedReturnedQtyByOrderItem).netRevenue,
      0
    );

    // Calculate stats
    const stats = {
      totalProducts: productsList.length,
      activeOrders: ordersList.filter(o => 
        o.status !== 'delivered' &&
        o.status !== 'cancelled' &&
        o.status !== 'returned' &&
        !isRevenueRecognizedOrder(o)
      ).length,
      totalRevenue: netRecognizedRevenue,
      pendingQuotes: ordersList.filter(o => 
        o.status === 'pending' ||
        (o.status === 'confirmed' && String(o.channel || '').toLowerCase() !== 'offline_sale')
      ).length
    };

    // Format products for response
    const formattedProducts = productsList.slice(0, 10).map(product => ({
      id: product.id,
      name: product.name,
      category: product.category,
      price: parseFloat(product.price || 0),
      unit: product.unit,
      stock: product.stock,
      description: product.description
    }));

    // Format live orders with service provider info
    const supplierOrdersSlice = ordersList.slice(0, 10);
    const supplierOrderIds = supplierOrdersSlice.map((o) => o.id).filter(Boolean);
    let supplierInvoiceByOrderId = new Map();
    if (supplierOrderIds.length > 0) {
      const { data: supplierInvoiceRows } = await supabase
        .from('invoices')
        .select('order_id, invoice_number, metadata')
        .in('order_id', supplierOrderIds);
      supplierInvoiceByOrderId = new Map((supplierInvoiceRows || []).map((inv) => [inv.order_id, inv]));
    }

    const formattedOrders = await Promise.all(
      supplierOrdersSlice.map(async (order) => {
        const { data: serviceProvider } = await supabase
          .from('users')
          .select('name, company, user_type')
          .eq('id', order.service_provider_id)
          .single();

        const channel = order.channel || null;
        const buyerIsSupplier = serviceProvider?.user_type === 'supplier';
        const chainUpstreamOrder = channel === 'b2b_po' && buyerIsSupplier;
        const inv = supplierInvoiceByOrderId.get(order.id);

        return {
          id: order.order_number || order.id,
          orderNumber: order.order_number,
          customer: serviceProvider?.name || serviceProvider?.company || 'Service Provider',
          company: serviceProvider?.company || '',
          amount: parseFloat(order.total_amount || 0),
          status: order.status,
          paymentStatus: order.payment_status || 'pending',
          createdAt: formatDate(order.created_at),
          itemCount: order.order_items?.length || 0,
          channel,
          chainUpstreamOrder,
          buyerIsSupplier,
          invoiceNumber: inv?.invoice_number || null,
          invoicePdfUrl: inv?.metadata?.pdfUrl || null
        };
      })
    );

    res.json({
      status: 'success',
      stats,
      products: formattedProducts,
      orders: formattedOrders
    });
  } catch (error) {
    console.error('Supplier dashboard error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Get service provider order details
}
