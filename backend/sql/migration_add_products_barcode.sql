-- ============================================
-- MIGRATION: Add barcode column to products
-- ============================================
-- Purpose:
-- - Standardize barcode support for global catalog + offline POS
-- - Let /pos/product/barcode/:code work reliably against products table
--
-- Run this in Supabase SQL Editor AFTER the base schema and before
-- or alongside other feature migrations.
-- ============================================

-- 1) Add barcode column to products if it does not exist
ALTER TABLE products
ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);

-- 2) Optional: enforce uniqueness if you want one global product per barcode.
--    If you expect multiple suppliers/variants per barcode, keep this commented
--    and instead model barcodes in a separate lookup table later.
-- ALTER TABLE products
-- ADD CONSTRAINT products_barcode_unique UNIQUE (barcode);

-- 3) Index for fast lookup from POS scans and search
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

