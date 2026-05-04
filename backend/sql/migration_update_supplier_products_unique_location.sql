-- ============================================
-- MIGRATION: Allow same product for a supplier
-- at multiple locations with different stock
-- ============================================

-- Drop the old unique constraint that only allowed
-- one row per (product_id, supplier_id)
ALTER TABLE supplier_products
DROP CONSTRAINT IF EXISTS supplier_products_product_id_supplier_id_key;

-- Add a new unique constraint that allows the same
-- product + supplier combination to exist at multiple
-- locations, but only once per specific location.
ALTER TABLE supplier_products
ADD CONSTRAINT supplier_products_product_supplier_location_key
UNIQUE (product_id, supplier_id, location);

