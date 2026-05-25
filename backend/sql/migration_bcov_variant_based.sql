-- ============================================
-- MIGRATION: Refactor supplier_bcov_levels to variant-based
-- Each pricing slab is per variant (variant_key) instead of brand
-- ============================================

-- Add variant columns
ALTER TABLE supplier_bcov_levels
  ADD COLUMN IF NOT EXISTS variant_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS variant_asin VARCHAR(32),
  ADD COLUMN IF NOT EXISTS variant_name VARCHAR(220);

-- Backfill variant_key from brand_name for existing rows (treat old brand as variant scope)
UPDATE supplier_bcov_levels
SET variant_key = normalized_brand,
    variant_name = brand_name
WHERE variant_key IS NULL OR btrim(variant_key) = '';

-- Make variant_key NOT NULL after backfill
ALTER TABLE supplier_bcov_levels
  ALTER COLUMN variant_key SET NOT NULL;

-- Drop old brand-based indexes
DROP INDEX IF EXISTS idx_supplier_bcov_levels_brand;
DROP INDEX IF EXISTS idx_supplier_bcov_levels_qty;

-- Create new variant-based indexes
CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_variant
  ON supplier_bcov_levels(supplier_id, variant_key);

CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_variant_qty
  ON supplier_bcov_levels(supplier_id, variant_key, min_purchase_qty);

CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_variant_asin
  ON supplier_bcov_levels(supplier_id, variant_asin)
  WHERE variant_asin IS NOT NULL AND btrim(variant_asin) <> '';
