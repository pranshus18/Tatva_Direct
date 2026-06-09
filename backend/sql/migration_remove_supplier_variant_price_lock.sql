-- ============================================
-- MIGRATION: Remove single-MRP lock per product
-- ============================================
-- Each supplier sets their own catalog MRP on supplier_products.price.
-- Reverts migration_enforce_supplier_variant_price_lock.sql.

DROP TRIGGER IF EXISTS trg_enforce_supplier_variant_price_lock ON supplier_products;
DROP FUNCTION IF EXISTS enforce_supplier_variant_price_lock();
