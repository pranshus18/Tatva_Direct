-- ============================================
-- MIGRATION: Track products requested by service providers
-- ============================================
-- Purpose:
-- - Allow a service provider to request creation of a new catalog product
-- - Store which service provider originally requested the product
-- - Enable notification flows when suppliers later add this product
--
-- Run this in Supabase SQL Editor AFTER the base schema and previous
-- migrations (including supplier_products and payment_receipts) are applied.
-- ============================================

-- 1) Add requested_by_service_provider_id column to products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS requested_by_service_provider_id UUID REFERENCES users(id);

-- Optional index to quickly find products requested by a service provider
CREATE INDEX IF NOT EXISTS idx_products_requested_by_sp
  ON products(requested_by_service_provider_id);

