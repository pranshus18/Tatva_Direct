-- ============================================
-- MIGRATION: Add outlet_id to supplier_products
-- ============================================
-- Purpose:
-- - Link each supplier_products row to a specific outlet (store/warehouse)
-- - Keep location (text) for backward compatibility
--
-- This is additive and non-breaking:
-- - outlet_id is nullable for now
-- - Existing unique constraint on (product_id, supplier_id, location) is preserved
-- ============================================

ALTER TABLE supplier_products
ADD COLUMN IF NOT EXISTS outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;

-- Optional index to speed up outlet-based queries
CREATE INDEX IF NOT EXISTS idx_supplier_products_outlet ON supplier_products(outlet_id);

