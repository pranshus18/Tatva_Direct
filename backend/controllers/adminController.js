import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import db from '../services/db.js';
import logger from '../utils/logger.js';
import { requireAdminPrivileges } from '../middleware/adminMiddleware.js';
import { fetchClosedReturnQuantityByOrderItem, getNetItemMetrics } from '../utils/netRevenue.js';
import { registerAdminAiEnhanceRoutes } from './admin/adminAiEnhanceRoutes.js';
import { registerProductWorkflowRoutes } from './admin/productWorkflowRoutes.js';
import { registerAdminNotificationRoutes } from './admin/notificationRoutes.js';
import { registerAdminBrandAndSupplyChainRoutes } from './admin/brandAndSupplyChainRoutes.js';
import { registerAdminPlatformOpsRoutes } from './admin/platformOpsRoutes.js';
import { registerAdminUserManagementRoutes } from './admin/userManagementRoutes.js';
import { registerAdminProductModerationRoutes } from './admin/productModerationRoutes.js';
import { adminUpdateProductSchema } from '../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { normalizeModelIdentifier, sanitizeSpecifications } from '../services/supplierCatalogHelpersService.js';

const router = express.Router();
const console = {
  log: (...args) => logger.debug(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args)
};

const isRevenueRecognizedOrder = (order) => {
  const paymentStatus = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  // Revenue should drop automatically for cancelled/returned orders.
  return paymentStatus === 'paid' && status !== 'cancelled' && status !== 'returned';
};

const normalizeValue = (value) => (value === null || value === undefined ? '' : String(value).trim());
const pickFirstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = normalizeValue(value);
    if (normalized) return normalized;
  }
  return '';
};
const buildProductIdentification = ({ skuNo, modelBrand }) => {
  const parts = [skuNo, modelBrand].map(normalizeValue);
  if (parts.every((p) => !p)) return '';
  return parts.join('');
};

// Admin credentials from environment variables
const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL || 'admin@tatvadirect.com',
  password: process.env.ADMIN_PASSWORD || '' // Should be set in production
};

registerAdminBrandAndSupplyChainRoutes({ router, authenticateToken, isAdmin: requireAdminPrivileges, supabase });

// Generate comprehensive admin data
const generateAdminData = async () => {
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

registerAdminPlatformOpsRoutes({
  router,
  authenticateToken,
  isAdmin: requireAdminPrivileges,
  supabase,
  generateAdminData,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
});

registerAdminUserManagementRoutes({
  router,
  authenticateToken,
  isAdmin: requireAdminPrivileges,
  supabase,
  db,
  isRevenueRecognizedOrder,
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics
});

// Update product (admin only)
// Get all products with status filtering (admin only)
// IMPORTANT: This route must be BEFORE /products/:id to avoid route conflicts
router.get('/products/all', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const { status } = req.query;
    
    console.log('🔍 Querying products from Supabase...');
    
    // Get ALL products - try inferred relationship first
    let { data: allProducts, error: queryError } = await supabase
      .from('products')
      .select(`
        *,
        supplier:users(id, name, email, company)
      `)
      .order('created_at', { ascending: false });
    
    // If that fails, try with explicit constraint name
    if (queryError || !allProducts) {
      console.log('Trying alternative join syntax for products...');
      const { data: productsAlt, error: productsAltError } = await supabase
        .from('products')
        .select(`
          *,
          supplier:users!products_supplier_id_fkey (id, name, email, company)
        `)
        .order('created_at', { ascending: false });
      
      if (!productsAltError && productsAlt) {
        allProducts = productsAlt;
        queryError = null;
      } else {
        console.error('Products query error:', productsAltError || queryError);
      }
    }
    
    // If joins still fail, fetch products without join first, then join suppliers manually
    if (queryError || !allProducts) {
      console.log('Fetching products without supplier join...');
      const { data: productsOnly, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!productsError && productsOnly) {
        allProducts = productsOnly;
        queryError = null;
        console.log(`Fetched ${allProducts.length} products without supplier join`);
      }
    }
    
    // If we have products but no supplier data, join suppliers manually
    if (allProducts && allProducts.length > 0 && (!allProducts[0].supplier || allProducts.some(p => !p.supplier && p.supplier_id))) {
      console.log('Joining suppliers manually for products...');
      const supplierIds = [...new Set(allProducts.map(p => p.supplier_id).filter(Boolean))];
      
      if (supplierIds.length > 0) {
        const { data: suppliers } = await supabase
          .from('users')
          .select('id, name, email, company')
          .in('id', supplierIds);
        
        if (suppliers) {
          const suppliersMap = {};
          suppliers.forEach(s => { suppliersMap[s.id] = s; });
          
          allProducts = allProducts.map(product => ({
            ...product,
            supplier: product.supplier_id ? suppliersMap[product.supplier_id] : null
          }));
          console.log(`Joined ${suppliers.length} suppliers to products`);
        }
      }
    }

    // Always reconcile price/stock from supplier_products.
    // Supplier portal updates inventory in `supplier_products`, but this admin page
    // previously relied on legacy `products.price/stock`, which can stay 0.
    if (allProducts && allProducts.length > 0) {
      const productIds = [...new Set((allProducts || []).map((p) => p.id).filter(Boolean))];

      if (productIds.length > 0) {
        const { data: spRows, error: spRowsError } = await supabase
          .from('supplier_products')
          .select('product_id, price, stock, min_order_quantity, location, status, is_active, supplier_id, attributes, igst_rate, cgst_rate, sgst_rate')
          .in('product_id', productIds);

        if (!spRowsError && spRows) {
          const bestRowByProductId = new Map();

          for (const row of spRows) {
            if (!row?.product_id) continue;

            const rowStatus = row.status;
            const rowIsActive = row.is_active === true;
            const stock = Number.isFinite(parseInt(row.stock)) ? parseInt(row.stock) : 0;
            const price = Number.isFinite(parseFloat(row.price)) ? parseFloat(row.price) : 0;
            const score =
              rowStatus === 'approved' && rowIsActive ? 2 :
              rowStatus === 'approved' ? 1 : 0;

            const existing = bestRowByProductId.get(row.product_id);
            if (!existing) {
              bestRowByProductId.set(row.product_id, { ...row, _score: score, _stock: stock, _price: price });
              continue;
            }

            // Choose:
            // 1) approved+active (score)
            // 2) higher stock
            // 3) lower price
            if (
              score > existing._score ||
              (score === existing._score && stock > existing._stock) ||
              (score === existing._score && stock === existing._stock && price < existing._price)
            ) {
              bestRowByProductId.set(row.product_id, { ...row, _score: score, _stock: stock, _price: price });
            }
          }

          allProducts = allProducts.map((p) => {
            const best = bestRowByProductId.get(p.id);
            if (!best) return p;

            return {
              ...p,
              // Admin cards show a single price/stock per product card,
              // so we show the best available supplier offer.
              price: best.price,
              stock: best.stock,
              min_order_quantity: best.min_order_quantity ?? p.min_order_quantity,
              location: best.location ?? p.location,
              igst_rate: best.igst_rate ?? best?.attributes?.igstRate ?? p.igst_rate ?? null,
              cgst_rate: best.cgst_rate ?? best?.attributes?.cgstRate ?? p.cgst_rate ?? null,
              sgst_rate: best.sgst_rate ?? best?.attributes?.sgstRate ?? p.sgst_rate ?? null,
              hsnCode: best?.attributes?.hsnCode ?? p.hsnCode ?? p.hsn_code ?? null,
              brandModel: best?.attributes?.brandModel ?? p.brandModel ?? null
            };
          });
        } else {
          console.error('Admin products price/stock reconcile error:', spRowsError);
        }
      }
    }

    // Final fallback: products can exist without `products.supplier_id` (legacy/shared),
    // but `supplier_products` still contains the real supplier who offered the product.
    // Admin UI expects to always show a supplier name.
    const productsMissingSupplier = (allProducts || []).filter(
      (p) => (!p.supplier || !p.supplier.id) && !p.supplier_id
    );
    if (productsMissingSupplier.length > 0) {
      const missingProductIds = [...new Set(productsMissingSupplier.map(p => p.id))];
      const { data: spRows, error: spRowsError } = await supabase
        .from('supplier_products')
        .select(`
          product_id,
          supplier:users!supplier_products_supplier_id_fkey (id, name, email, company),
          status,
          is_active
        `)
        .in('product_id', missingProductIds);

      if (!spRowsError && spRows) {
        const bestByProduct = new Map();
        for (const row of spRows) {
          if (!row?.supplier?.id) continue;
          const productId = row.product_id;

          const rowScore =
            row.status === 'approved' && row.is_active === true
              ? 2
              : row.status === 'approved'
                ? 1
                : 0;

          const existing = bestByProduct.get(productId);
          const existingScore =
            existing?.status === 'approved' && existing?.is_active === true
              ? 2
              : existing?.status === 'approved'
                ? 1
                : 0;

          if (!existing || rowScore > existingScore) {
            bestByProduct.set(productId, row);
          }
        }

        allProducts = allProducts.map((p) => {
          if (p.supplier?.id) return p;
          const best = bestByProduct.get(p.id);
          return {
            ...p,
            supplier: best?.supplier || null,
          };
        });

        console.log(`Backfilled suppliers from supplier_products for ${missingProductIds.length} products`);
      } else {
        console.error('Backfill suppliers error:', spRowsError);
      }
    }
    
    // Only throw error if we have no products at all
    if (queryError && (!allProducts || allProducts.length === 0)) {
      console.error('Failed to fetch products:', queryError);
      throw queryError;
    }
    
    console.log(`Found ${(allProducts || []).length} total products in database`);
    
    // Log sample products for debugging
    if (allProducts && allProducts.length > 0) {
      console.log('Sample products:', allProducts.slice(0, 3).map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        supplier: p.supplier?.name || 'No supplier',
        supplier_id: p.supplier_id
      })));
    } else {
      console.log('No products found in database!');
    }

    // Build one trackable identifier for each product:
    // skuNo+modelBrand
    allProducts = (allProducts || []).map((p) => {
      const specs = p?.specifications || {};
      const skuNo = pickFirstNonEmpty(
        p?.skuNo,
        p?.sku_no,
        specs?.skuNo,
        specs?.sku_no,
        specs?.sku,
        specs?.SKU,
        specs?.gsku,
        specs?.GSKU
      );
      const modelBrand = pickFirstNonEmpty(p?.brandModel, p?.brand_model, specs?.brandModel, specs?.brand_model, specs?.brand, specs?.modelBrand);
      const productIdentification = buildProductIdentification({ skuNo, modelBrand });

      return {
        ...p,
        skuNo: skuNo || null,
        modelBrand: modelBrand || null,
        productIdentification: productIdentification || null
      };
    });
    
    // Filter by status in JavaScript
    let products = allProducts || [];
    if (status && status !== 'all') {
      if (status === 'pending') {
        // Pending: anything that's not approved or rejected
        products = (allProducts || []).filter(p => {
          const s = p.status;
          return !s || s === 'pending' || s === '' || (s !== 'approved' && s !== 'rejected');
        });
        console.log(`Filtered to ${products.length} pending products`);
      } else if (status === 'approved') {
        products = (allProducts || []).filter(p => p.status === 'approved');
        console.log(`Filtered to ${products.length} approved products`);
      } else if (status === 'rejected') {
        products = (allProducts || []).filter(p => p.status === 'rejected');
        console.log(`Filtered to ${products.length} rejected products`);
      }
    }
    
    // Log product statuses for debugging
    if (allProducts && allProducts.length > 0) {
      const statusCounts = {};
      allProducts.forEach(p => {
        const s = p.status || 'null/undefined';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      console.log('Product status breakdown:', statusCounts);
    }
    
    res.json({ 
      status: 'success',
      products: products || [],
      count: products ? products.length : 0,
      totalInDatabase: (allProducts || []).length,
      database: 'Supabase (PostgreSQL)'
    });
  } catch (error) {
    console.error('Get all products error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Return empty array on error so page doesn't break
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message,
      products: [],
      count: 0,
      database: 'Supabase (PostgreSQL)'
    });
  }
});

// Get single product by ID (admin only)
router.get('/products/:id([0-9a-fA-F-]{36})', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select(`
        *,
        supplier:users!products_supplier_id_fkey (id, name, email, company)
      `)
      .eq('id', req.params.id)
      .single();
    
    if (error || !product) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found' 
      });
    }

    // Reconcile price/stock from supplier_products so admin sees latest supplier inventory.
    const { data: spRows, error: spRowsError } = await supabase
      .from('supplier_products')
      .select('product_id, price, stock, min_order_quantity, location, status, is_active, supplier_id, attributes, igst_rate, cgst_rate, sgst_rate')
      .eq('product_id', product.id);

    if (!spRowsError && spRows && spRows.length > 0) {
      const bestRowByScore = spRows
        .map((row) => {
          const rowStatus = row.status;
          const rowIsActive = row.is_active === true;
          const stock = Number.isFinite(parseInt(row.stock)) ? parseInt(row.stock) : 0;
          const price = Number.isFinite(parseFloat(row.price)) ? parseFloat(row.price) : 0;
          const score =
            rowStatus === 'approved' && rowIsActive ? 2 :
            rowStatus === 'approved' ? 1 : 0;

          return { row, _score: score, _stock: stock, _price: price };
        })
        .sort((a, b) => {
          if (b._score !== a._score) return b._score - a._score;
          if (b._stock !== a._stock) return b._stock - a._stock;
          return a._price - b._price;
        })[0]?.row;

      if (bestRowByScore) {
        product.price = bestRowByScore.price;
        product.stock = bestRowByScore.stock;
        product.min_order_quantity = bestRowByScore.min_order_quantity ?? product.min_order_quantity;
        product.location = bestRowByScore.location ?? product.location;
        product.igst_rate = bestRowByScore.igst_rate ?? bestRowByScore?.attributes?.igstRate ?? product.igst_rate ?? null;
        product.cgst_rate = bestRowByScore.cgst_rate ?? bestRowByScore?.attributes?.cgstRate ?? product.cgst_rate ?? null;
        product.sgst_rate = bestRowByScore.sgst_rate ?? bestRowByScore?.attributes?.sgstRate ?? product.sgst_rate ?? null;
        product.hsnCode = bestRowByScore?.attributes?.hsnCode ?? product.hsnCode ?? product.hsn_code ?? null;
        product.brandModel = bestRowByScore?.attributes?.brandModel ?? product.brandModel ?? null;
      }
    }

    const specs = product?.specifications || {};
    const skuNo = pickFirstNonEmpty(
      product?.skuNo,
      product?.sku_no,
      specs?.skuNo,
      specs?.sku_no,
      specs?.sku,
      specs?.SKU,
      specs?.gsku,
      specs?.GSKU
    );
    const modelBrand = pickFirstNonEmpty(product?.brandModel, product?.brand_model, specs?.brandModel, specs?.brand_model, specs?.brand, specs?.modelBrand);
    const productIdentification = buildProductIdentification({ skuNo, modelBrand });
    product.skuNo = skuNo || null;
    product.modelBrand = modelBrand || null;
    product.productIdentification = productIdentification || null;
    
    res.json({ 
      status: 'success',
      product,
      supplier: product.supplier
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.put('/products/:id([0-9a-fA-F-]{36})', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const validatedBody = parseWithSchema(adminUpdateProductSchema, req.body || {});
    console.log('[ADMIN UPDATE] Received update request for product:', req.params.id);
    console.log('[ADMIN UPDATE] Request body keys:', Object.keys(validatedBody));
    console.log('[ADMIN UPDATE] Request body category:', validatedBody.category);
    console.log('[ADMIN UPDATE] Request body specifications:', validatedBody.specifications);
    console.log('[ADMIN UPDATE] Request body specs keys count:', validatedBody.specifications ? Object.keys(validatedBody.specifications).length : 0);
    
    // Preserve specifications, including null values (null represents keys that need values)
    const updateData = { ...validatedBody };
    
    // Extract GST/tax fields - these belong to supplier_products, not products.
    const parseTax = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const allowedIgst = new Set([0, 5, 12, 18, 28]);
    const allowedCgstSgst = new Set([0, 2.5, 6, 9, 14]);

    const rawIgst = updateData.igst_rate ?? updateData.igstRate;
    const rawCgst = updateData.cgst_rate ?? updateData.cgstRate;
    const rawSgst = updateData.sgst_rate ?? updateData.sgstRate;
    const rawHsnCode = updateData.hsnCode ?? updateData.hsn_code;
    const requestedHsnUpdate = rawHsnCode !== undefined;
    const normalizedHsnCode = rawHsnCode === null || rawHsnCode === undefined
      ? ''
      : String(rawHsnCode).trim();
    if (requestedHsnUpdate && normalizedHsnCode !== '' && !/^\d{4,8}$/.test(normalizedHsnCode)) {
      return res.status(400).json({
        status: 'error',
        message: 'HSN code must be 4 to 8 digits.'
      });
    }
    const requestedTaxUpdate =
      rawIgst !== undefined || rawCgst !== undefined || rawSgst !== undefined;

    const normalizedTax = {
      igst_rate: parseTax(rawIgst),
      cgst_rate: parseTax(rawCgst),
      sgst_rate: parseTax(rawSgst)
    };

    if (requestedTaxUpdate) {
      const hasAllTaxValues =
        normalizedTax.igst_rate !== null &&
        normalizedTax.cgst_rate !== null &&
        normalizedTax.sgst_rate !== null;
      const hasAnyTaxValue =
        normalizedTax.igst_rate !== null ||
        normalizedTax.cgst_rate !== null ||
        normalizedTax.sgst_rate !== null;

      if (hasAnyTaxValue && !hasAllTaxValues) {
        return res.status(400).json({
          status: 'error',
          message: 'Please provide IGST, CGST, and SGST together.'
        });
      }

      if (hasAllTaxValues) {
        if (!allowedIgst.has(normalizedTax.igst_rate)) {
          return res.status(400).json({ status: 'error', message: 'Invalid IGST rate.' });
        }
        if (!allowedCgstSgst.has(normalizedTax.cgst_rate) || !allowedCgstSgst.has(normalizedTax.sgst_rate)) {
          return res.status(400).json({ status: 'error', message: 'Invalid CGST/SGST rate.' });
        }
        if (normalizedTax.cgst_rate !== normalizedTax.sgst_rate) {
          return res.status(400).json({ status: 'error', message: 'CGST and SGST must be equal.' });
        }
        if (Number((normalizedTax.cgst_rate + normalizedTax.sgst_rate).toFixed(2)) !== Number(normalizedTax.igst_rate.toFixed(2))) {
          return res.status(400).json({ status: 'error', message: 'IGST must equal CGST + SGST.' });
        }
      }
    }

    // Ensure tax fields are never sent to products table.
    delete updateData.igst_rate;
    delete updateData.cgst_rate;
    delete updateData.sgst_rate;
    delete updateData.igstRate;
    delete updateData.cgstRate;
    delete updateData.sgstRate;
    delete updateData.hsnCode;
    delete updateData.hsn_code;

    // Convert camelCase field names to snake_case for database
    if (updateData.minOrderQuantity !== undefined) {
      updateData.min_order_quantity = parseInt(updateData.minOrderQuantity) || 1;
      delete updateData.minOrderQuantity;
    }
    
    // Ensure numeric fields are properly typed
    if (updateData.price !== undefined) {
      updateData.price = parseFloat(updateData.price) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = parseInt(updateData.stock) || 0;
    }
    
    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData._id;
    delete updateData.supplier_id;
    delete updateData.supplier;
    delete updateData.created_at;
    delete updateData.status; // Status can only be changed via approve/reject endpoints
    delete updateData.approved_by;
    delete updateData.approved_at;
    delete updateData.rejection_reason;
    
    // Remove any undefined values to avoid Supabase errors
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    // Ensure specifications object is preserved as-is (including null values)
    if (updateData.specifications && typeof updateData.specifications === 'object') {
      // Keep all keys, even with null values - they represent specification keys that need values
      // Only remove undefined values, but keep null
      Object.keys(updateData.specifications).forEach(key => {
        if (updateData.specifications[key] === undefined) {
          delete updateData.specifications[key];
        }
        // Keep null values - they're placeholders for keys
      });
    }
    
    console.log('[ADMIN UPDATE] After cleanup - updateData keys:', Object.keys(updateData));
    console.log('[ADMIN UPDATE] After cleanup - updateData.category:', updateData.category);
    console.log('[ADMIN UPDATE] After cleanup - updateData.min_order_quantity:', updateData.min_order_quantity);
    console.log('[ADMIN UPDATE] After cleanup - updateData.specifications keys:', updateData.specifications ? Object.keys(updateData.specifications) : 'none');
    
    // Update product in Supabase
    const { data: product, error: updateError } = await supabase
      .from('products')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('[ADMIN UPDATE] Supabase update error:', updateError);
      console.error('[ADMIN UPDATE] Error code:', updateError.code);
      console.error('[ADMIN UPDATE] Error message:', updateError.message);
      console.error('[ADMIN UPDATE] Error details:', updateError.details);
      console.error('[ADMIN UPDATE] Error hint:', updateError.hint);
      
      return res.status(400).json({ 
        status: 'error',
        message: updateError.message || 'Product update failed',
        error: updateError.code || 'UPDATE_ERROR',
        details: updateError.details || null
      });
    }
    
    if (!product) {
      console.error('[ADMIN UPDATE] Product not found after update');
      return res.status(404).json({ 
        status: 'error',
        message: 'Product not found after update' 
      });
    }
    
    // Ensure specifications are included in response
    const productResponse = { ...product };
    if (!productResponse.specifications) {
      productResponse.specifications = {};
    }
    
    // Convert snake_case to camelCase for frontend compatibility
    if (productResponse.min_order_quantity !== undefined) {
      productResponse.minOrderQuantity = productResponse.min_order_quantity;
    }

    console.log('[ADMIN UPDATE] Product saved successfully');
    console.log('[ADMIN UPDATE] Product ID:', productResponse.id);
    console.log('[ADMIN UPDATE] Product name:', productResponse.name);
    console.log('[ADMIN UPDATE] Product category:', productResponse.category);
    console.log('[ADMIN UPDATE] Product price:', productResponse.price);
    console.log('[ADMIN UPDATE] Product stock:', productResponse.stock);
    console.log('[ADMIN UPDATE] Product min_order_quantity:', productResponse.min_order_quantity);
    console.log('[ADMIN UPDATE] Product specifications:', productResponse.specifications);
    console.log('[ADMIN UPDATE] Product specs keys count:', Object.keys(productResponse.specifications).length);
    console.log('[ADMIN UPDATE] Product specs keys:', Object.keys(productResponse.specifications));

    // Persist tax fields on supplier_products (per-offer inventory table), not on products.
    if (requestedTaxUpdate || requestedHsnUpdate) {
      try {
        const taxUpdateData = {
          updated_at: new Date().toISOString()
        };
        if (requestedTaxUpdate) {
          taxUpdateData.igst_rate = normalizedTax.igst_rate;
          taxUpdateData.cgst_rate = normalizedTax.cgst_rate;
          taxUpdateData.sgst_rate = normalizedTax.sgst_rate;
        }

        let spUpdateResult = null;
        const primarySupplierId = validatedBody?.supplier_id || validatedBody?.supplier?.id || productResponse?.supplier_id || null;

        if (primarySupplierId) {
          const { data } = await supabase
            .from('supplier_products')
            .update(taxUpdateData)
            .eq('product_id', req.params.id)
            .eq('supplier_id', primarySupplierId)
            .select('id, product_id, supplier_id, attributes')
            .limit(1);
          spUpdateResult = data;
        }

        if (!spUpdateResult || spUpdateResult.length === 0) {
          const { data } = await supabase
            .from('supplier_products')
            .update(taxUpdateData)
            .eq('product_id', req.params.id)
            .select('id, product_id, supplier_id, attributes');
          spUpdateResult = data;
        }

        if (spUpdateResult && spUpdateResult.length > 0) {
          // Keep JSON attributes mirror for compatibility with older readers.
          for (const row of spUpdateResult) {
            const mergedAttrs = {
              ...(row.attributes || {}),
              igstRate: normalizedTax.igst_rate,
              cgstRate: normalizedTax.cgst_rate,
              sgstRate: normalizedTax.sgst_rate
            };
            if (requestedHsnUpdate) {
              mergedAttrs.hsnCode = normalizedHsnCode || null;
            }
            await supabase
              .from('supplier_products')
              .update({
                attributes: mergedAttrs,
                updated_at: new Date().toISOString()
              })
              .eq('id', row.id);
          }
          if (requestedTaxUpdate) {
            productResponse.igst_rate = normalizedTax.igst_rate;
            productResponse.cgst_rate = normalizedTax.cgst_rate;
            productResponse.sgst_rate = normalizedTax.sgst_rate;
          }
          if (requestedHsnUpdate) {
            productResponse.hsnCode = normalizedHsnCode || null;
          }
        } else {
          console.warn('⚠️ [ADMIN UPDATE] No supplier_products rows found for tax update on product:', req.params.id);
        }
      } catch (taxError) {
        console.error('❌ [ADMIN UPDATE] Failed to persist tax rates on supplier_products:', taxError);
        // Non-fatal: product update succeeded.
      }
    }

    // If admin has set specifications for this product, sync them as:
    // 1) category default template (broad fallback), and
    // 2) model profile (exact same product match for all suppliers).
    try {
      const hasCategory = !!productResponse.category;
      const hasSpecs = !!productResponse.specifications;
      const hasSpecKeys = productResponse.specifications && Object.keys(productResponse.specifications).length > 0;
      
      console.log('🔄 [ADMIN SYNC] Checking sync conditions:');
      console.log('🔄 [ADMIN SYNC] - Has category?', hasCategory);
      console.log('🔄 [ADMIN SYNC] - Has specs object?', hasSpecs);
      console.log('🔄 [ADMIN SYNC] - Has spec keys?', hasSpecKeys);
      
      if (hasCategory && hasSpecs && hasSpecKeys) {
        const categoryName = String(productResponse.category).trim().toLowerCase();
        console.log(`🔄 [ADMIN SYNC] Syncing specs to category: "${categoryName}"`);
        console.log(`📦 [ADMIN SYNC] Product specs:`, productResponse.specifications);
        
        // Find or create the category
        let { data: category } = await supabase
          .from('categories')
          .select('*')
          .eq('name', categoryName)
          .single();
        
        if (!category) {
          // Category doesn't exist - create it
          console.log(`⚠️ [ADMIN SYNC] Category "${categoryName}" not found, creating it...`);
          const { data: newCategory } = await supabase
            .from('categories')
            .insert({
              name: categoryName,
              display_name: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
              is_active: true,
              created_by: req.userId
            })
            .select()
            .single();
          
          category = newCategory;
          console.log(`✅ [ADMIN SYNC] Created category "${categoryName}"`);
        }
        
        // Build template specs from product specifications
        const templateSpecs = {};
        const productSpecKeys = Object.keys(productResponse.specifications || {});
        console.log(`📋 [ADMIN SYNC] Product has ${productSpecKeys.length} specification keys:`, productSpecKeys);
        
        productSpecKeys.forEach((key) => {
          if (key && key.trim() !== '') {
            // Store only the key with null value so each supplier can
            // provide their own values for these admin-defined keys.
            templateSpecs[key] = null;
          }
        });

        // Only update if we actually have some keys
        if (Object.keys(templateSpecs).length > 0) {
          const safeSpecs = sanitizeSpecifications(productResponse.specifications || {});
          const { data: updatedCategory } = await supabase
            .from('categories')
            .update({
              default_specifications: templateSpecs,
              updated_at: new Date().toISOString()
            })
            .eq('id', category.id)
            .select()
            .single();
          
          console.log(`✅ [ADMIN SYNC] Updated defaultSpecifications for category "${category.name}"`);
          console.log(`📋 [ADMIN SYNC] Saved template specs:`, JSON.stringify(templateSpecs, null, 2));
          console.log(`🔑 [ADMIN SYNC] Total keys saved: ${Object.keys(templateSpecs).length}`);
          
          // Verify the save worked by fetching fresh from database
          const { data: verifyCategory } = await supabase
            .from('categories')
            .select('*')
            .eq('name', categoryName)
            .single();
          
          if (verifyCategory && verifyCategory.default_specifications) {
            const verifyKeys = Object.keys(verifyCategory.default_specifications);
            console.log(`✅ [ADMIN SYNC] Verified: Category "${categoryName}" now has ${verifyKeys.length} default specs`);
            console.log(`✅ [ADMIN SYNC] Verified keys:`, verifyKeys);
            console.log(`✅ [ADMIN SYNC] Verified specs object:`, JSON.stringify(verifyCategory.default_specifications, null, 2));
          } else {
            console.error(`❌ [ADMIN SYNC] Verification failed: Category "${categoryName}" defaultSpecifications not found after save`);
            console.error(`❌ [ADMIN SYNC] Verify category object:`, verifyCategory);
          }

          // Also persist model-level profile so "same product name/model"
          // in supplier portal resolves to this exact spec set.
          const modelRaw =
            String(productResponse.mpn || '').trim() ||
            String(productResponse.name || '').trim();
          const modelIdentifier = normalizeModelIdentifier(modelRaw);
          if (modelIdentifier) {
            const { error: modelSyncError } = await supabase
              .from('model_spec_profiles')
              .upsert(
                {
                  category: categoryName,
                  model_identifier: modelIdentifier,
                  display_model: modelRaw,
                  specifications: Object.keys(safeSpecs).length > 0 ? safeSpecs : templateSpecs,
                  updated_by: req.userId,
                  updated_at: new Date().toISOString()
                },
                { onConflict: 'category,model_identifier' }
              );
            if (modelSyncError) {
              console.error('❌ [ADMIN SYNC] Failed to sync model_spec_profiles:', modelSyncError);
            } else {
              console.log(`✅ [ADMIN SYNC] Synced model profile for "${modelIdentifier}" in category "${categoryName}"`);
            }
          }
        } else {
          console.log(`ℹ️ [ADMIN SYNC] No valid keys to save for category "${categoryName}"`);
          console.log(`ℹ️ [ADMIN SYNC] Product specs keys:`, productSpecKeys);
          console.log(`ℹ️ [ADMIN SYNC] Template specs built:`, templateSpecs);
        }
      } else {
        console.log(`ℹ️ [ADMIN SYNC] Skipping sync - category: ${!!productResponse.category}, specs: ${!!productResponse.specifications}, keys: ${productResponse.specifications ? Object.keys(productResponse.specifications).length : 0}`);
      }
    } catch (syncError) {
      // Do not block the main response if syncing category template fails
      console.error('❌ [ADMIN SYNC] Failed to sync category defaultSpecifications from admin product update:', syncError);
    }
    
    res.json({ 
      status: 'success',
      message: 'Product updated successfully',
      product: productResponse
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update product error:', error);
    
    // Handle Supabase validation errors
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        status: 'error',
        message: 'Validation Error',
        errors: ['Duplicate entry']
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

registerAdminProductModerationRoutes({ router, authenticateToken, isAdmin: requireAdminPrivileges, supabase });

registerAdminNotificationRoutes({ router, authenticateToken, isAdmin: requireAdminPrivileges, supabase });
registerProductWorkflowRoutes({ router, authenticateToken, isAdmin: requireAdminPrivileges, supabase });

registerAdminAiEnhanceRoutes({ router, authenticateToken, isAdmin: requireAdminPrivileges });

export { router as adminRouter, ADMIN_CREDENTIALS };