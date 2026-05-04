-- ============================================
-- MIGRATION: Add variation number (child ASIN-like)
-- ============================================
-- Purpose:
-- - Assign a stable unique number per exact product variation.
-- - Same parent product + same variation key => same variant_asin.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE supplier_products
ADD COLUMN IF NOT EXISTS variant_asin VARCHAR(24);

-- Backfill from parent product ASIN + variant_key.
UPDATE supplier_products sp
SET variant_asin = upper(substr(
  encode(
    digest(
      COALESCE(p.asin, '') || '|' || COALESCE(sp.variant_key, ''),
      'sha256'
    ),
    'hex'
  ),
  1,
  12
))
FROM products p
WHERE p.id = sp.product_id
  AND (sp.variant_asin IS NULL OR btrim(sp.variant_asin) = '');

-- Safety fallback for any row that still has blank variant_asin.
UPDATE supplier_products sp
SET variant_asin = upper(substr(encode(digest(sp.id::text, 'sha256'), 'hex'), 1, 12))
WHERE sp.variant_asin IS NULL OR btrim(sp.variant_asin) = '';

ALTER TABLE supplier_products
ALTER COLUMN variant_asin SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_products_variant_asin
ON supplier_products(variant_asin);
