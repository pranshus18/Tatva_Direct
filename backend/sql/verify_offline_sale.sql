-- ============================================
-- Quick Verification Script for Offline Sales
-- ============================================
-- Run this after completing an offline sale to verify everything is correct
-- ============================================

-- 1. Get the latest offline sale order
WITH latest_order AS (
  SELECT 
    id, 
    order_number, 
    outlet_id, 
    customer_id, 
    total_amount, 
    payment_status,
    payment_method,
    status,
    created_at
  FROM orders
  WHERE channel = 'offline_sale'
  ORDER BY created_at DESC
  LIMIT 1
)

-- 2. Complete verification report
SELECT 
  '=== ORDER VERIFICATION ===' as section,
  lo.order_number as "Order Number",
  lo.total_amount as "Total Amount",
  lo.payment_status as "Payment Status",
  lo.payment_method as "Payment Method",
  lo.status as "Order Status",
  CASE WHEN lo.outlet_id IS NOT NULL THEN '✅' ELSE '❌' END as "Has Outlet",
  CASE WHEN lo.customer_id IS NOT NULL THEN '✅' ELSE '⚠️' END as "Has Customer",
  lo.created_at as "Created At"
FROM latest_order lo

UNION ALL

-- 3. Order Items Verification
SELECT 
  '=== ORDER ITEMS ===' as section,
  'Item Count: ' || COUNT(oi.id)::text as "Order Number",
  'Total Qty: ' || COALESCE(SUM(oi.quantity)::text, '0') as "Total Amount",
  'Items with supplier_product_id: ' || COUNT(CASE WHEN oi.supplier_product_id IS NOT NULL THEN 1 END)::text as "Payment Status",
  '' as "Payment Method",
  '' as "Order Status",
  CASE WHEN COUNT(CASE WHEN oi.supplier_product_id IS NULL THEN 1 END) = 0 THEN '✅ All items have supplier_product_id' ELSE '❌ Some items missing supplier_product_id' END as "Has Outlet",
  '' as "Has Customer",
  NULL::timestamp as "Created At"
FROM latest_order lo
LEFT JOIN order_items oi ON oi.order_id = lo.id

UNION ALL

-- 4. Stock Reduction Verification
SELECT 
  '=== STOCK REDUCTION ===' as section,
  p.name as "Order Number",
  'Qty Sold: ' || ABS(SUM(im.quantity_change))::text as "Total Amount",
  'Movement Type: ' || im.movement_type as "Payment Status",
  'Current Stock: ' || sp.stock::text as "Payment Method",
  '' as "Order Status",
  CASE WHEN SUM(im.quantity_change) < 0 THEN '✅ Stock Reduced' ELSE '❌ Stock Not Reduced' END as "Has Outlet",
  'Previous: ' || (sp.stock - SUM(im.quantity_change))::text as "Has Customer",
  im.created_at as "Created At"
FROM latest_order lo
JOIN inventory_movements im ON im.reference_order_id = lo.id
JOIN supplier_products sp ON sp.id = im.supplier_product_id
JOIN products p ON p.id = im.product_id
WHERE im.movement_type = 'sale_offline'
GROUP BY p.name, im.movement_type, sp.stock, im.created_at

UNION ALL

-- 5. Customer Verification (if exists)
SELECT 
  '=== CUSTOMER INFO ===' as section,
  c.name as "Order Number",
  c.phone as "Total Amount",
  c.email as "Payment Status",
  'Addresses: ' || COUNT(ca.id)::text as "Payment Method",
  '' as "Order Status",
  CASE WHEN c.id IS NOT NULL THEN '✅ Customer Created' ELSE '⚠️ No Customer' END as "Has Outlet",
  '' as "Has Customer",
  c.created_at as "Created At"
FROM latest_order lo
LEFT JOIN customers c ON c.id = lo.customer_id
LEFT JOIN customer_addresses ca ON ca.customer_id = c.id
GROUP BY c.id, c.name, c.phone, c.email, c.created_at;

-- ============================================
-- DETAILED BREAKDOWN QUERIES
-- ============================================

-- View all order items with stock info
SELECT 
  oi.id as order_item_id,
  oi.quantity as qty_sold,
  oi.unit_price,
  oi.total_price,
  oi.supplier_product_id,
  p.name as product_name,
  p.barcode,
  sp.stock as current_outlet_stock,
  CASE 
    WHEN oi.supplier_product_id IS NULL THEN '❌ MISSING - Stock will NOT reduce!'
    ELSE '✅ Set correctly'
  END as supplier_product_status
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
LEFT JOIN supplier_products sp ON sp.id = oi.supplier_product_id
WHERE o.channel = 'offline_sale'
ORDER BY o.created_at DESC
LIMIT 10;

-- View inventory movements
SELECT 
  im.id,
  im.movement_type,
  im.quantity_change,
  im.reference_order_id,
  im.reference_order_item_id,
  p.name as product_name,
  sp.stock as current_stock,
  o.order_number,
  im.created_at
FROM inventory_movements im
JOIN products p ON p.id = im.product_id
JOIN supplier_products sp ON sp.id = im.supplier_product_id
LEFT JOIN orders o ON o.id = im.reference_order_id
WHERE im.movement_type = 'sale_offline'
ORDER BY im.created_at DESC
LIMIT 10;

-- Check stock before and after (for specific product)
SELECT 
  sp.id as supplier_product_id,
  p.name as product_name,
  p.barcode,
  sp.stock as current_stock,
  sp.outlet_id,
  o.name as outlet_name,
  -- Calculate what stock should be based on movements
  (sp.stock - COALESCE(SUM(CASE WHEN im.movement_type = 'sale_offline' THEN ABS(im.quantity_change) ELSE 0 END), 0)) as estimated_original_stock
FROM supplier_products sp
JOIN products p ON p.id = sp.product_id
LEFT JOIN outlets o ON o.id = sp.outlet_id
LEFT JOIN inventory_movements im ON im.supplier_product_id = sp.id
WHERE p.barcode = '1234567890123'  -- Replace with your test barcode
GROUP BY sp.id, p.name, p.barcode, sp.stock, sp.outlet_id, o.name;
