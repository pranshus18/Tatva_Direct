-- ============================================
-- Tatva Direct (Offline + Online Selling) - Complete Supabase Schema
-- ============================================
-- Paste this entire file into Supabase SQL Editor and run.
--
-- This schema is SAFE to run on existing databases:
-- - Creates only missing tables
-- - Adds only missing columns to existing tables
-- - Creates indexes safely
--
-- Based on actual database inspection via MCP:
-- Existing tables: users, categories, units, products, boqs, boq_items,
--                  outlets, supplier_products, orders, order_items,
--                  inventory_movements, supplier_ratings, notifications,
--                  payment_receipts, invoices, ledger_entries
--
-- Missing tables: customers, customer_addresses
-- Missing columns: products.requested_by_service_provider_id,
--                  orders.customer_id, orders.shipping_provider,
--                  orders.tracking_number, orders.tracking_url
-- ============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- --------------------------------------------
-- Shared helper: updated_at trigger function
-- --------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ============================================
-- NEW TABLES (only create if missing)
-- ============================================

-- CUSTOMERS (B2C end users)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- CUSTOMER ADDRESSES (minimal: name + phone only)
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- ============================================
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- ============================================

-- Products: add requested_by_service_provider_id
ALTER TABLE products
ADD COLUMN IF NOT EXISTS requested_by_service_provider_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_products_requested_by_sp ON products(requested_by_service_provider_id) WHERE requested_by_service_provider_id IS NOT NULL;

-- Orders: add customer_id, shipping_provider, tracking_number, tracking_url
DO $$
BEGIN
  -- Add customer_id only if customers table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
    
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id) WHERE customer_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(100);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(120);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS tracking_url TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number) WHERE tracking_number IS NOT NULL;

-- ============================================
-- ENSURE ALL INDEXES EXIST (safe, won't duplicate)
-- ============================================

-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- Orders indexes (if columns exist)
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel) WHERE channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_outlet ON orders(outlet_id) WHERE outlet_id IS NOT NULL;

-- Order items indexes
CREATE INDEX IF NOT EXISTS idx_order_items_supplier_product ON order_items(supplier_product_id) WHERE supplier_product_id IS NOT NULL;

-- ============================================
-- VERIFICATION (optional - uncomment to check)
-- ============================================
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- ORDER BY table_name;
--
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' 
--   AND table_name IN ('products', 'orders', 'customers', 'customer_addresses')
-- ORDER BY table_name, ordinal_position;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Schema update complete! All missing tables and columns have been added.';
END $$;
