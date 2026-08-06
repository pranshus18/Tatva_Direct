/** Dashboard routes: orderDetail */
import {
  generateAndAttachReceiptPdf,
  normalizeUserAddress
} from './dashboardImports.js';
import { resolveOrderChargeBreakdown } from '../../utils/orderChargeBreakdown.js';
export * from './shared/dashboardHelpers.js';

export function registerDashboardOrderDetailRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/service-provider/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    // Set cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    console.log(`[Order Details] Fetching order details for ID: ${decodedId}, User: ${req.userId} (type: ${typeof req.userId})`);
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          product:products (*)
        ),
        boq:boqs (id, name)
      `)
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .single();
    
    if (orderError) {
      console.log(`[Order Details] Error finding by order_number:`, orderError);
    } else if (order) {
      console.log(`[Order Details] Found order by order_number: ${order.id}`);
    }
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      console.log(`[Order Details] Trying to find by ID: ${decodedId}`);
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (*)
          ),
          boq:boqs (id, name)
        `)
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .single();
      
      if (orderByIdError) {
        console.log(`[Order Details] Error finding by id:`, orderByIdError);
      }
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
        console.log(`[Order Details] Found order by id: ${order.id}`);
      }
    }
    
    if (orderError || !order) {
      console.log(`[Order Details] Order not found: ${decodedId} for user ${req.userId}`);
      // Debug: Check if order exists for any user
      const { data: anyOrder, count } = await supabase
        .from('orders')
        .select('id, order_number, service_provider_id', { count: 'exact' })
        .or(`order_number.eq.${decodedId},id.eq.${decodedId}`);
      console.log(`[Order Details] Debug: Found ${count || 0} orders with ID/order_number ${decodedId}`);
      if (anyOrder && anyOrder.length > 0) {
        console.log(`[Order Details] Debug: Order exists but service_provider_id mismatch:`, {
          order_service_provider_id: anyOrder[0].service_provider_id,
          request_user_id: req.userId,
          match: anyOrder[0].service_provider_id === req.userId
        });
      }
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to view this order' 
      });
    }
    
    console.log(`[Order Details] Order found: ${order.id}, supplier_id: ${order.supplier_id}`);
    
    // Fetch supplier
    let supplier = null;
    if (order.supplier_id) {
      const { data: supplierData, error: supplierError } = await supabase
        .from('users')
        .select('id, name, company, email, phone, address, profile')
        .eq('id', order.supplier_id)
        .single();
      
      if (supplierError) {
        console.error(`[Order Details] Error fetching supplier:`, supplierError);
      } else {
        const prof = supplierData?.profile || {};
        const { profile: _profile, ...supplierRest } = supplierData;
        supplier = {
          ...supplierRest,
          address: normalizeUserAddress(supplierData?.address || {}, supplierData?.profile || {}),
          upiVpa: prof.upiVpa || prof.paymentUpi || prof.upi_id || null
        };
        console.log(`[Order Details] Supplier fetched:`, supplier?.name || supplier?.company || 'N/A');
      }
    } else {
      console.log(`[Order Details] No supplier_id in order`);
    }
    
    order.supplier = supplier;
    
    // Enrich order items from immutable order snapshot captured at order creation.
    // This prevents later supplier edits from changing already placed order details.
    const orderItems = Array.isArray(order.order_items) ? order.order_items : [];
    order.order_items = orderItems.map((it) => {
      let snapshot = {};
      if (it?.specifications && typeof it.specifications === 'object') {
        snapshot = it.specifications;
      } else if (typeof it?.specifications === 'string') {
        try {
          snapshot = JSON.parse(it.specifications);
        } catch {
          snapshot = {};
        }
      }
      const variantAttributes =
        snapshot?.variantAttributes && typeof snapshot.variantAttributes === 'object'
          ? snapshot.variantAttributes
          : {};

      return {
        ...it,
        // Frontend expects camelCase keys
        unitPrice: parseFloat(it?.unit_price ?? it?.unitPrice ?? 0) || 0,
        totalPrice: parseFloat(it?.total_price ?? it?.totalPrice ?? 0) || 0,
        // Keep tracking/identity immutable from order-time snapshot (supplier offer at placement).
        asin: snapshot?.parentAsin || it?.product?.asin || null,
        parentAsin: snapshot?.parentAsin || it?.product?.asin || null,
        variantKey: snapshot?.variantKey || null,
        variantAsin: snapshot?.variantAsin || null,
        productTrackingId: snapshot?.variantAsin || null,
        brandModel: snapshot?.brandModel ?? variantAttributes?.brandModel ?? null
      };
    });

    // Attach invoice + PDF URL (if invoice PDF was generated after payment)
    let invoice = null;
    try {
      const { data: invoiceRow } = await supabase
        .from('invoices')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      invoice = invoiceRow || null;
    } catch (e) {
      console.error('[Order Details] Failed to fetch invoice:', e);
    }
    let receipt = null;
    try {
      const { data: receiptRow } = await supabase
        .from('payment_receipts')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      receipt = receiptRow || null;
      if (receipt && !receipt?.metadata?.pdfUrl) {
        const { data: serviceProviderData } = await supabase
          .from('users')
          .select('id, name, company, email')
          .eq('id', order.service_provider_id)
          .maybeSingle();
        const backfilled = await generateAndAttachReceiptPdf({
          receipt,
          order,
          supplier,
          serviceProvider: serviceProviderData || null
        });
        receipt = backfilled?.receipt || receipt;
      }
    } catch (e) {
      console.error('[Order Details] Failed to fetch receipt:', e);
    }

    // Fetch return requests for this order (service-provider view).
    let returns = [];
    try {
      const { data: returnRows } = await supabase
        .from('order_returns')
        .select('*')
        .eq('order_id', order.id)
        .eq('service_provider_id', req.userId)
        .order('created_at', { ascending: false });
      returns = returnRows || [];
    } catch (e) {
      console.error('[Order Details] Failed to fetch returns:', e);
    }

    // Format order for frontend
    const chargeBreakdown = resolveOrderChargeBreakdown(order);
    const formattedOrder = {
      ...order,
      orderNumber: order.order_number || order.id,
      totalAmount: chargeBreakdown.combinedTotal,
      chargeBreakdown,
      paymentStatus: order.payment_status || 'pending',
      paymentMethod: order.payment_method,
      status: order.status || 'pending',
      createdAt: order.created_at,
      updatedAt: order.updated_at || order.created_at,
      channel: order.channel || null,
      statusHistory: Array.isArray(order.status_history) ? order.status_history : [],
      trackingNumber: order.tracking_number || null,
      trackingUrl: order.tracking_url || null,
      shippingProvider: order.shipping_provider || null,
      expectedDeliveryDate: order.expected_delivery_date,
      actualDeliveryDate: order.actual_delivery_date,
      deliveryAddress: order.delivery_address,
      items: order.order_items || [],
      supplier: supplier,
      boq: order.boq || null,
      invoice: invoice,
      invoicePdfUrl: invoice?.metadata?.pdfUrl || null,
      receipt: receipt,
      receiptPdfUrl: receipt?.metadata?.pdfUrl || null,
      returns
    };
    
    console.log(`[Order Details] Returning order details for: ${formattedOrder.orderNumber}`);
    
    res.json({ 
      status: 'success',
      order: formattedOrder
    });
  } catch (error) {
    console.error('[Order Details] Get service provider order details error:', error);
    console.error('[Order Details] Error stack:', error.stack);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// Create return request (service provider)
}
