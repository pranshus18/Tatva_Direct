-- ============================================
-- MIGRATION: Core B2C Support (Customers + Addresses)
-- ============================================
-- Purpose:
-- - Add end customers for B2C (retail) sales
-- - Store multiple addresses per customer
-- - Link existing orders table to a customer (optional for B2B/POs)
--
-- Safe to run multiple times.
-- ============================================

-- 1) Customers (B2C end users)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  metadata JSONB DEFAULT '{}'::jsonb, -- e.g. {gstin, loyaltyId, notes}
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- 2) Customer addresses (minimal: name + phone only)
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- 3) Link orders to customers (optional per order)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- Optional helper indexes for analytics
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

