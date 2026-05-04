-- ============================================
-- MIGRATION: Add basic shipment tracking fields to orders
-- ============================================
-- Purpose:
-- - Allow suppliers to store tracking information for online/B2B orders
-- - Allow service providers to see tracking like other ecommerce platforms
--
-- Safe to run multiple times.
-- ============================================

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(100);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(120);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS tracking_url TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);

