-- ============================================
-- MIGRATION: Add Amazon-style product identity columns
-- ============================================
-- Purpose:
-- - Support strong catalog identity matching:
--   1) GTIN exact
--   2) Brand + MPN exact
--   3) Catalog key fallback
-- - Store ASIN-like deterministic identifier for internal catalog identity.
-- ============================================

ALTER TABLE products
ADD COLUMN IF NOT EXISTS asin VARCHAR(20),
ADD COLUMN IF NOT EXISTS gtin VARCHAR(64),
ADD COLUMN IF NOT EXISTS mpn VARCHAR(128),
ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
ADD COLUMN IF NOT EXISTS catalog_key VARCHAR(64);

-- Unique indexes for strong identity signals (ignore blank values).
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_gtin_not_blank
ON products (gtin)
WHERE gtin IS NOT NULL AND btrim(gtin) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_brand_mpn_not_blank
ON products (brand, mpn)
WHERE brand IS NOT NULL AND btrim(brand) <> ''
  AND mpn IS NOT NULL AND btrim(mpn) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_catalog_key_not_blank
ON products (catalog_key)
WHERE catalog_key IS NOT NULL AND btrim(catalog_key) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_asin_not_blank
ON products (asin)
WHERE asin IS NOT NULL AND btrim(asin) <> '';
