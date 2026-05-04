import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { createReceiptAndDeliver } from '../services/paymentReceiptService.js';
import { createInvoiceForOrder } from '../services/invoiceService.js';
import { sendEmail } from '../services/emailService.js';
import { generateAndUploadInvoicePdf, saveInvoicePdfUrlToInvoice } from '../services/invoicePdfService.js';
import { generateAndAttachReceiptPdf } from '../services/receiptPdfService.js';
import { recordInventoryMovement } from '../services/inventoryService.js';
import { applyRestockForClosedReturn } from '../services/returnInventoryService.js';
import { fetchClosedReturnQuantityByOrderItem, getNetItemMetrics } from '../utils/netRevenue.js';
import { notifyAdminsForPortalAction } from '../services/portalActivityService.js';
import { createAdminWriteNotifyMiddleware } from '../middleware/adminWriteNotifyMiddleware.js';
import { registerDashboardOrderDeletionRoutes } from './dashboard/orderDeletionRoutes.js';
import { insertNotification, insertNotifications } from '../repositories/notificationsRepository.js';
import { findAdmins, findUserBasicById } from '../repositories/usersRepository.js';
import {
  acknowledgeReturnClosureSchema,
  createReturnRequestSchema,
  updateOrderPaymentSchema
} from '../contracts/dashboardContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';

const router = express.Router();

function normalizeOrderNumberForTracking(orderNumber = '') {
  const normalized = String(orderNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'ORDER';
}

function buildReturnTrackingId(orderNumber = '', suffix = '') {
  const orderPart = normalizeOrderNumberForTracking(orderNumber);
  const base = `RET-${orderPart}`;
  if (!suffix) return base;
  return `${base}-${String(suffix).toUpperCase()}`;
}

async function ensureUniqueReturnTrackingId({ preferredTrackingId = '', orderNumber = '' }) {
  const preferred = String(preferredTrackingId || '').trim();
  const baseGenerated = buildReturnTrackingId(orderNumber);
  const candidates = preferred ? [preferred, baseGenerated] : [baseGenerated];
  const maxSuffixAttempts = 1000;

  for (const candidate of candidates) {
    const { data: existing, error } = await supabase
      .from('order_returns')
      .select('id')
      .eq('tracking_id', candidate)
      .maybeSingle();
    if (!error && !existing) return candidate;
  }

  for (let i = 2; i <= maxSuffixAttempts; i += 1) {
    const candidate = buildReturnTrackingId(orderNumber, `R${i}`);
    const { data: existing, error } = await supabase
      .from('order_returns')
      .select('id')
      .eq('tracking_id', candidate)
      .maybeSingle();
    if (!error && !existing) return candidate;
  }

  // Final fallback should be very rare; keeps route from failing.
  return buildReturnTrackingId(orderNumber, Date.now().toString(36));
}

function normalizeUserAddress(address = {}, profile = {}) {
  const branches = Array.isArray(profile?.branches) ? profile.branches : [];
  const firstBranch = branches.find((b) => b && typeof b === 'object') || {};
  const source = address && typeof address === 'object' ? address : {};

  const line1 = String(
    source.line1 || source.street || firstBranch.address || firstBranch.line1 || ''
  ).trim();
  const line2 = String(source.line2 || source.area || firstBranch.line2 || '').trim();
  const city = String(source.city || firstBranch.city || '').trim();
  const state = String(source.state || firstBranch.state || '').trim();
  const zipCode = String(
    source.zipCode || source.pincode || source.postalCode || firstBranch.zipCode || firstBranch.pincode || ''
  ).trim();
  const country = String(source.country || firstBranch.country || '').trim();

  return {
    ...source,
    street: line1,
    line1,
    line2,
    city,
    state,
    zipCode,
    pincode: zipCode,
    country
  };
}

function isRevenueRecognizedOrder(order) {
  const paymentStatus = String(order?.payment_status || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  // Revenue is recognized when payment is captured, regardless of channel
  // (online / offline), except cancelled/returned orders.
  return paymentStatus === 'paid' && status !== 'cancelled' && status !== 'returned';
}

async function restockInventoryForCancelledOrder({ orderId, actorUserId }) {
  if (!orderId) return { ok: false, reason: 'missing_order_id' };

  // Prevent double-restock by checking if we already recorded a cancel-restock movement.
  const { data: existingRestock } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('reference_order_id', orderId)
    .eq('movement_type', 'adjustment')
    .ilike('notes', '%cancel_restock%')
    .limit(1);

  if (existingRestock && existingRestock.length > 0) {
    return { ok: true, already: true };
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, supplier_id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'order_not_found' };

  // Only restock on cancelled orders.
  if (String(order.status || '') !== 'cancelled') return { ok: true, skipped: true };

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_id, supplier_product_id, quantity')
    .eq('order_id', orderId);

  for (const it of items || []) {
    const qty = parseFloat(it.quantity || 0) || 0;
    if (!qty || qty <= 0) continue;
    if (!it.supplier_product_id) continue;

    await recordInventoryMovement({
      supplierProductId: it.supplier_product_id,
      supplierId: order.supplier_id,
      productId: it.product_id,
      quantityChange: Math.round(qty),
      movementType: 'adjustment',
      referenceOrderId: orderId,
      referenceOrderItemId: it.id,
      notes: 'cancel_restock: inventory added back due to order cancellation',
      userId: actorUserId
    });
  }

  return { ok: true, already: false };
}

// Auto-notify admins on all successful write actions from this router.
router.use(createAdminWriteNotifyMiddleware({ supabase, notifyAdminsForPortalAction }));

// Service Provider Dashboard
router.get('/service-provider', authenticateToken, async (req, res) => {
  try {
    const userType = String(req.user?.user_type || '').toLowerCase();
    if (userType !== 'service_provider' && userType !== 'admin') {
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
        // Keep tracking/identity immutable from order-time snapshot.
        variantKey: snapshot?.variantKey || null,
        variantAsin: snapshot?.variantAsin || null,
        productTrackingId:
          snapshot?.variantAsin ||
          null,
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
    const formattedOrder = {
      ...order,
      orderNumber: order.order_number || order.id,
      totalAmount: parseFloat(order.total_amount || 0),
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
router.post('/service-provider/orders/:id/returns', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    const payload = parseWithSchema(createReturnRequestSchema, req.body || {});
    const { orderItemId, quantity, reason, trackingId } = payload;

    const requestedQty = Number(quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid quantity' });
    }

    let { data: order } = await supabase
      .from('orders')
      .select('id, order_number, service_provider_id, supplier_id, status')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (!order) {
      const { data: orderById } = await supabase
        .from('orders')
        .select('id, order_number, service_provider_id, supplier_id, status')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .maybeSingle();
      order = orderById || null;
    }

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const { data: orderItem } = await supabase
      .from('order_items')
      .select('id, quantity')
      .eq('id', orderItemId)
      .eq('order_id', order.id)
      .maybeSingle();

    if (!orderItem) {
      return res.status(404).json({ status: 'error', message: 'Order item not found' });
    }

    const orderedQty = Number(orderItem.quantity || 0);
    if (requestedQty > orderedQty) {
      return res.status(400).json({
        status: 'error',
        message: `Return quantity cannot exceed ordered quantity (${orderedQty})`
      });
    }

    const statusHistory = [
      {
        status: 'requested',
        by: req.userId,
        note: reason,
        at: new Date().toISOString()
      }
    ];

    const uniqueTrackingId = await ensureUniqueReturnTrackingId({
      preferredTrackingId: trackingId,
      orderNumber: order.order_number
    });

    const { data: created, error: createErr } = await supabase
      .from('order_returns')
      .insert({
        order_id: order.id,
        order_item_id: orderItem.id,
        service_provider_id: req.userId,
        supplier_id: order.supplier_id,
        quantity: requestedQty,
        reason: String(reason).trim(),
        tracking_id: uniqueTrackingId,
        status: 'requested',
        status_history: statusHistory
      })
      .select('*')
      .single();

    if (createErr) {
      console.error('[Returns] create error:', createErr);
      return res.status(500).json({ status: 'error', message: 'Failed to create return request' });
    }

    // Notify supplier
    try {
      await insertNotification({
        user_id: order.supplier_id,
        type: 'order_return_requested',
        title: `Return requested for ${order.order_number}`,
        message: `A return request was created for order ${order.order_number}.`,
        related_order_id: order.id,
        is_read: false,
        metadata: {
          returnId: created.id,
          orderItemId: orderItem.id,
          quantity: requestedQty
        }
      }, supabase);
    } catch (notifErr) {
      console.error('[Returns] supplier notification failed:', notifErr);
    }

    // Notify admins as well (return requests are operationally important).
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);

      if (admins && admins.length > 0) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: 'order_return_requested',
          title: `Return requested for ${order.order_number}`,
          message: `Service provider requested return for order ${order.order_number}.`,
          related_order_id: order.id,
          is_read: false,
          metadata: {
            returnId: created.id,
            orderItemId: orderItem.id,
            quantity: requestedQty,
            supplierId: order.supplier_id,
            serviceProviderId: req.userId
          }
        }));
        await insertNotifications(notifications, supabase);
      }
    } catch (adminNotifErr) {
      console.error('[Returns] admin notification failed:', adminNotifErr);
    }

    return res.json({ status: 'success', returnRequest: created });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Returns] create request error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// List return requests for current service provider
router.get('/service-provider/returns', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('order_returns')
      .select('*')
      .eq('service_provider_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Returns] service-provider list error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to fetch return requests' });
    }

    return res.json({ status: 'success', returns: data || [] });
  } catch (error) {
    console.error('[Returns] service-provider list exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Confirm return completion from the service-provider side (after supplier has closed the return).
// Applies inventory restock idempotently — safe if stock was already restored when the supplier marked closed.
router.patch('/service-provider/returns/:id/acknowledge-closure', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(acknowledgeReturnClosureSchema, req.body || {});
    const { id } = req.params;

    const { data: row, error: fetchErr } = await supabase
      .from('order_returns')
      .select('*')
      .eq('id', id)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (fetchErr || !row) {
      return res.status(404).json({ status: 'error', message: 'Return request not found' });
    }

    if (String(row.status || '') !== 'closed') {
      return res.status(400).json({
        status: 'error',
        message:
          'The supplier must mark this return as closed before you can confirm completion.'
      });
    }

    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const alreadyAcked = Boolean(meta.buyer_acknowledged_closure_at);
    const buyerAt = new Date().toISOString();

    let merged = row;
    if (!alreadyAcked) {
      const { data: updated, error: updErr } = await supabase
        .from('order_returns')
        .update({
          metadata: { ...meta, buyer_acknowledged_closure_at: buyerAt }
        })
        .eq('id', id)
        .eq('service_provider_id', req.userId)
        .select('*')
        .single();

      if (updErr) {
        console.error('[Returns] acknowledge-closure update error:', updErr);
        return res.status(500).json({ status: 'error', message: 'Failed to update return request' });
      }
      merged = updated;
    }

    let restock = { ok: true, skipped: true };
    try {
      restock = await applyRestockForClosedReturn(merged, req.userId);
    } catch (restockErr) {
      console.error('[Returns] acknowledge-closure restock error:', restockErr);
      return res.status(500).json({
        status: 'error',
        message: 'Your confirmation was saved, but inventory could not be updated. Please try again or contact support.',
        returnRequest: merged,
        inventory: { ok: false, error: String(restockErr.message || restockErr) }
      });
    }

    return res.json({
      status: 'success',
      returnRequest: merged,
      inventory: restock
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Returns] acknowledge-closure exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update payment status for service provider order
router.patch('/service-provider/orders/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = parseWithSchema(updateOrderPaymentSchema, req.body || {});
    const { paymentStatus, paymentMethod, paymentReference, paidAt } = payload;
    const decodedId = decodeURIComponent(id);
    
    console.log(`Updating payment status for order: ${decodedId}, Status: ${paymentStatus}, User: ${req.userId}`);
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .single();
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .single();
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }
    
    if (orderError || !order) {
      console.log(`Order not found for payment update: ${decodedId} for user ${req.userId}`);
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to update this order' 
      });
    }
    
    // Get current status history
    const statusHistory = order.status_history || [];
    
    // Add to status history
    statusHistory.push({
      status: order.status,
      updatedBy: req.userId,
      notes: `Payment status updated to ${paymentStatus}`,
      timestamp: new Date().toISOString()
    });
    
    // Update payment status
    const updateData = {
      payment_status: paymentStatus,
      status_history: statusHistory
    };
    
    if (paymentMethod) {
      updateData.payment_method = paymentMethod;
    }
    
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id)
      .select(`
        *,
        order_items (
          *,
          product:products (*)
        ),
        supplier:users!orders_supplier_id_fkey (id, name, company, email, phone, address),
        boq:boqs (id, name)
      `)
      .single();
    
    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update payment status'
      });
    }
    
    // If payment status is updated to "paid", create a notification for the supplier
    if (paymentStatus === 'paid' && order.supplier_id) {
      try {
        await insertNotification({
          user_id: order.supplier_id,
          type: 'payment_received',
          title: 'Payment Received',
          message: `Payment of ₹${parseFloat(order.total_amount || 0).toLocaleString('en-IN')} has been received for Order ${order.order_number}`,
          related_order_id: order.id,
          is_read: false
        }, supabase);
        console.log(`Notification created for supplier ${order.supplier_id} about payment for order ${order.order_number}`);
      } catch (notifError) {
        console.error('Error creating payment notification:', notifError);
      }
    }

    // If paid: create an auditable receipt and deliver it to BOTH parties (notifications + optional email)
    let receiptDelivery = null;
    let invoiceDelivery = null;
    if (paymentStatus === 'paid') {
      try {
        receiptDelivery = await createReceiptAndDeliver({
          order: updatedOrder,
          paymentMethod: paymentMethod || updatedOrder.payment_method,
          paymentReference,
          paidAt,
          actorUserId: req.userId
        });
      } catch (receiptErr) {
        console.error('[Payment] Receipt generation/delivery failed:', receiptErr);
        // Do not fail the payment status update if receipt delivery fails.
      }

      // Generate a tracking-aware Invoice PDF and provide it to both parties
      try {
        const { invoice } = await createInvoiceForOrder(updatedOrder);
        const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({
          order: updatedOrder,
          invoice
        });

        invoiceDelivery = {
          invoiceNumber: invoice?.invoice_number || null,
          pdfUrl: pdfUrl || null
        };

        if (pdfUrl) {
          await saveInvoicePdfUrlToInvoice({
            orderId: updatedOrder.id,
            pdfUrl,
            pdfPath
          });

          // Best-effort email link delivery (if email exists/configured).
          const [{ data: supplier }, { data: serviceProvider }] = await Promise.all([
            updatedOrder.supplier_id
              ? findUserBasicById(updatedOrder.supplier_id, supabase)
              : Promise.resolve({ data: null }),
            updatedOrder.service_provider_id
              ? findUserBasicById(updatedOrder.service_provider_id, supabase)
              : Promise.resolve({ data: null })
          ]);

          const subject = `Invoice ${invoice?.invoice_number || ''} (Order ${updatedOrder.order_number})`.trim();
          const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.4;">
            <h2 style="margin:0 0 10px;">Invoice Ready</h2>
            <p style="margin:0 0 12px;">
              Your invoice <strong>${invoice?.invoice_number || ''}</strong> for
              <strong>Order ${updatedOrder.order_number}</strong> is generated successfully.
            </p>
            <p style="margin:0;">
              Download PDF:
              <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer">${pdfUrl}</a>
            </p>
          </div>
        `.trim();

          const emailResults = await Promise.all([
            supplier?.email
              ? sendEmail({
                  to: supplier.email,
                  subject,
                  text: `Invoice ${invoice?.invoice_number} generated. Download: ${pdfUrl}`,
                  html
                })
              : Promise.resolve(null),
            serviceProvider?.email
              ? sendEmail({
                  to: serviceProvider.email,
                  subject,
                  text: `Invoice ${invoice?.invoice_number} generated. Download: ${pdfUrl}`,
                  html
                })
              : Promise.resolve(null)
          ]);

          console.log('[Payment] Invoice PDF generated and email(s) attempted:', emailResults);
        }
      } catch (invoiceErr) {
        console.error('[Payment] Invoice PDF generation/delivery failed:', invoiceErr);
      }
    }
    
    console.log(`Payment status updated successfully: ${updatedOrder.order_number} to ${paymentStatus}`);
    
    res.json({ 
      status: 'success',
      message: 'Payment status updated successfully',
      order: updatedOrder,
      receipt: receiptDelivery?.receipt || null,
      invoice: invoiceDelivery || null
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update payment status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});

registerDashboardOrderDeletionRoutes({ router, authenticateToken, supabase, restockInventoryForCancelledOrder });

// Helper function to format dates
function formatDate(date) {
  if (!date) return 'N/A';
  
  const orderDate = new Date(date);
  
  // Format: "DD/MM/YYYY, HH:MM:SS"
  const day = String(orderDate.getDate()).padStart(2, '0');
  const month = String(orderDate.getMonth() + 1).padStart(2, '0');
  const year = orderDate.getFullYear();
  const hours = String(orderDate.getHours()).padStart(2, '0');
  const minutes = String(orderDate.getMinutes()).padStart(2, '0');
  const seconds = String(orderDate.getSeconds()).padStart(2, '0');
  
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

export { router as dashboardRouter };
