-- ============================================
-- MIGRATION: Extend supplier_products with attributes JSONB
-- This stores supplier-specific extra data (description, specs, etc.)
-- without changing the shared products table.
-- ============================================

ALTER TABLE supplier_products
ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}';

