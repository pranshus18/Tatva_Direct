/** Dashboard routes: serviceProviderDashboard */
import { formatDate } from './dashboardImports.js';

export function registerDashboardServiceProviderDashboardRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/service-provider', authenticateToken, async (req, res) => {
  try {
    const userType = String(req.user?.user_type || '').trim().toLowerCase();
    const normalizedUserType = userType.replace(/[\s-]+/g, '_');
    if (normalizedUserType !== 'service_provider' && normalizedUserType !== 'admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Service provider privileges required.'
      });
    }

    // Set cache-busting headers to ensure fresh data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // Get user's BOQs with items
    console.log(`[Dashboard] Fetching BOQs for user ID: ${req.userId} (type: ${typeof req.userId})`);
    
    // First, try to get BOQs with relation
    let { data: boqs, error: boqError } = await supabase
      .from('boqs')
      .select(`
        *,
        items:boq_items (*)
      `)
      .eq('service_provider_id', req.userId)
      .order('created_at', { ascending: false });

    // If relation query fails, try without relation and fetch items separately
    if (boqError) {
      console.error('[Dashboard] BOQ fetch error with relation:', boqError);
      console.log('[Dashboard] Trying fallback query without relation...');
      
      // Fallback: Get BOQs without relation
      const { data: boqsWithoutItems, error: boqError2 } = await supabase
        .from('boqs')
        .select('*')
        .eq('service_provider_id', req.userId)
        .order('created_at', { ascending: false });
      
      if (boqError2) {
        console.error('[Dashboard] BOQ fetch error (fallback):', boqError2);
        boqs = [];
      } else {
        // Fetch items separately for each BOQ
        boqs = boqsWithoutItems || [];
        for (const boq of boqs) {
          const { data: items } = await supabase
            .from('boq_items')
            .select('*')
            .eq('boq_id', boq.id);
          boq.items = items || [];
        }
        boqError = null;
      }
    }
    
    if (!boqError) {
      console.log(`[Dashboard] Found ${boqs?.length || 0} BOQs for user ${req.userId}`);
      if (boqs && boqs.length > 0) {
        console.log(`[Dashboard] BOQ IDs:`, boqs.map(b => b.id));
        console.log(`[Dashboard] Sample BOQ:`, {
          id: boqs[0].id,
          name: boqs[0].name,
          service_provider_id: boqs[0].service_provider_id,
          itemsCount: boqs[0].items?.length || 0
        });
      } else {
        // Debug: Check if there are any BOQs at all for this user
        const { data: allBoqs, count } = await supabase
          .from('boqs')
          .select('id, name, service_provider_id', { count: 'exact' })
          .eq('service_provider_id', req.userId);
        console.log(`[Dashboard] Debug: Total BOQs found for user: ${count || 0}`);
        if (allBoqs && allBoqs.length > 0) {
          console.log(`[Dashboard] Debug: BOQ service_provider_ids:`, allBoqs.map(b => ({
            id: b.id,
            name: b.name,
            service_provider_id: b.service_provider_id,
            type: typeof b.service_provider_id
          })));
        }
      }
    }
    
    // Get user's orders (as service provider)
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('service_provider_id', req.userId)
      .order('created_at', { ascending: false });

    if (orderError) {
      console.error('Order fetch error:', orderError);
    }

    const boqsList = boqs || [];
    const ordersList = orders || [];

    // Calculate stats
    const stats = {
      totalBOQs: boqsList.length,
      activePOs: ordersList.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length,
      totalSpent: ordersList
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0),
      pendingApprovals: ordersList.filter(o => 
        o.status === 'pending' || o.status === 'confirmed'
      ).length
    };

    // Format recent BOQs
    const recentBOQs = boqsList.slice(0, 5).map(boq => {
      const itemCount = Array.isArray(boq.items) ? boq.items.length : 0;
      return {
        id: boq.id,
        name: boq.name,
        itemCount: itemCount,
        createdAt: formatDate(boq.created_at),
        status: boq.status,
        totalValue: parseFloat(boq.total_value || 0)
      };
    });

    // Your orders (arrival tracking)
    // NOTE: We cap the list for performance; increase this if you expect many orders.
    const YOUR_ORDERS_LIMIT = 200;
    const ordersSlice = ordersList.slice(0, YOUR_ORDERS_LIMIT);
    const orderIdsForInvoices = ordersSlice.map((o) => o.id).filter(Boolean);
    let invoiceByOrderId = new Map();
    let receiptByOrderId = new Map();
    if (orderIdsForInvoices.length > 0) {
      const [{ data: invoiceRows }, { data: receiptRows }] = await Promise.all([
        supabase
          .from('invoices')
          .select('order_id, invoice_number, metadata')
          .in('order_id', orderIdsForInvoices),
        supabase
          .from('payment_receipts')
          .select('order_id, receipt_number, metadata')
          .in('order_id', orderIdsForInvoices)
      ]);
      invoiceByOrderId = new Map((invoiceRows || []).map((inv) => [inv.order_id, inv]));
      receiptByOrderId = new Map((receiptRows || []).map((rcpt) => [rcpt.order_id, rcpt]));
    }

    const yourOrders = await Promise.all(
      ordersSlice.map(async (order) => {
        // Fetch supplier
        const { data: supplier } = await supabase
          .from('users')
          .select('name, company')
          .eq('id', order.supplier_id)
          .single();

        const inv = invoiceByOrderId.get(order.id);
        const rcpt = receiptByOrderId.get(order.id);

        return {
          id: order.order_number || order.id,
          orderNumber: order.order_number,
          vendor: supplier?.name || supplier?.company || 'Supplier',
          vendorCompany: supplier?.company || '',
          amount: parseFloat(order.total_amount || 0),
          status: order.status,
          paymentStatus: order.payment_status || 'pending',
          paymentMethod: order.payment_method || null,
          itemCount: order.order_items?.length || 0,
          createdAt: order.created_at,
          createdAtFormatted: formatDate(order.created_at),
          expectedDeliveryDate: order.expected_delivery_date,
          actualDeliveryDate: order.actual_delivery_date,
          // Amazon-style timeline is derived from this history
          statusHistory: order.status_history || [],
          invoiceNumber: inv?.invoice_number || null,
          invoicePdfUrl: inv?.metadata?.pdfUrl || null,
          receiptNumber: rcpt?.receipt_number || null,
          receiptPdfUrl: rcpt?.metadata?.pdfUrl || null
        };
      })
    );

    // Keep existing UI working: recentPOs is a 5-item slice of yourOrders
    const recentPOs = yourOrders.slice(0, 5).map((po) => ({
      id: po.id,
      orderNumber: po.orderNumber,
      vendor: po.vendor,
      vendorCompany: po.vendorCompany,
      amount: po.amount,
      status: po.status,
      paymentStatus: po.paymentStatus,
      itemCount: po.itemCount,
      createdAt: po.createdAtFormatted,
      invoiceNumber: po.invoiceNumber || null,
      invoicePdfUrl: po.invoicePdfUrl || null,
      receiptNumber: po.receiptNumber || null,
      receiptPdfUrl: po.receiptPdfUrl || null
    }));

    res.json({
      status: 'success',
      stats,
      recentBOQs,
      recentPOs,
      yourOrders
    });
  } catch (error) {
    console.error('Service provider dashboard error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Supplier Dashboard
}
