-- ============================================
-- QUICK SETUP: Barcode & Offline Sale Test Data
-- ============================================
-- Run this in Supabase SQL Editor to set up test data for barcode scanning
-- ============================================

-- Step 1: Create a test product with barcode
INSERT INTO products (
  name, 
  description, 
  category, 
  price, 
  unit, 
  stock, 
  location, 
  supplier_id, 
  barcode, 
  is_active, 
  status
)
SELECT 
  'Test Product - Barcode 12345' as name,
  'Test product for barcode scanning and offline sales' as description,
  'Electronics' as category,
  150.00 as price,
  'piece' as unit,
  100 as stock,  -- Catalog stock
  'Warehouse A' as location,
  id as supplier_id,
  '12345' as barcode,  -- ⭐ Use this barcode for testing
  true as is_active,
  'approved' as status
FROM users
WHERE user_type = 'supplier'
LIMIT 1
ON CONFLICT DO NOTHING
RETURNING *;

-- Step 2: Create a test outlet (if doesn't exist)
INSERT INTO outlets (supplier_id, name, type, code, is_active)
SELECT 
  id as supplier_id,
  'Main Store' as name,
  'store' as type,
  'STORE001' as code,
  true as is_active
FROM users
WHERE user_type = 'supplier'
LIMIT 1
ON CONFLICT DO NOTHING
RETURNING *;

-- Step 3: Create supplier_product entry (links product to outlet with stock)
INSERT INTO supplier_products (
  product_id, 
  supplier_id, 
  price, 
  stock, 
  location, 
  outlet_id, 
  is_active, 
  status
)
SELECT 
  p.id as product_id,
  p.supplier_id,
  150.00 as price,
  50 as stock,  -- ⭐ Outlet has 50 units - watch this decrease after sale
  'Store Shelf A' as location,
  o.id as outlet_id,
  true as is_active,
  'approved' as status
FROM products p
CROSS JOIN outlets o
WHERE p.barcode = '12345'
  AND o.supplier_id = p.supplier_id
  AND NOT EXISTS (
    SELECT 1 FROM supplier_products sp 
    WHERE sp.product_id = p.id AND sp.outlet_id = o.id
  )
LIMIT 1
RETURNING *;

-- Step 4: Verify setup
SELECT 
  '✅ SETUP VERIFICATION' as status,
  p.id as product_id,
  p.name,
  p.barcode,
  p.stock as catalog_stock,
  sp.id as supplier_product_id,
  sp.stock as outlet_stock,
  sp.outlet_id,
  o.name as outlet_name,
  o.code as outlet_code
FROM products p
LEFT JOIN supplier_products sp ON sp.product_id = p.id
LEFT JOIN outlets o ON o.id = sp.outlet_id
WHERE p.barcode = '12345';

-- ============================================
-- TESTING INSTRUCTIONS:
-- ============================================
-- 1. Login as supplier in the frontend
-- 2. Go to "Offline Product Sell" page
-- 3. Select "Main Store" from location dropdown
-- 4. Enter barcode: 12345
-- 5. Click "Scan" - product should appear in bill
-- 6. Add customer name/phone (optional)
-- 7. Click "Proceed to Payment"
-- 8. Complete payment
-- 9. Check stock reduced: Run the verification query above again
-- ============================================
