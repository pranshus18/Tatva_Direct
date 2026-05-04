-- ============================================
-- MIGRATION: Add supplier_product_id to order_items
-- ============================================
-- Purpose:
-- - Walmart-style traceability: which outlet's stock was sold per line item
-- - Enables reporting by outlet, supplier_product, and channel
--
-- Run this in Supabase SQL Editor.
-- ============================================

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS supplier_product_id UUID REFERENCES supplier_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_supplier_product ON order_items(supplier_product_id);

COMMENT ON COLUMN order_items.supplier_product_id IS 'Links to supplier_products for outlet-level traceability (POS/offline sales)';
