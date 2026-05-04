-- ============================================
-- MIGRATION: Consolidated cityCode cleanup
-- ============================================
-- Purpose:
-- - Remove legacy cityCode/city_code/cityNo keys from supplier JSON payloads.
-- - Recompute supplier_products.variant_key without cityCode.
-- - Recompute supplier_products.variant_asin from refreshed variant_key.
--
-- Safe to run once in production after taking DB backup.
-- ============================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Remove city-like keys from supplier_products.attributes JSON
--    including nested specifications/variantAttributes/snapshot blocks.
UPDATE supplier_products sp
SET attributes = (
  jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(sp.attributes, '{}'::jsonb)
          - 'cityCode'
          - 'city_code'
          - 'cityNo'
          - 'city_no',
        '{specifications}',
        (
          COALESCE(sp.attributes->'specifications', '{}'::jsonb)
            - 'cityCode'
            - 'city_code'
            - 'cityNo'
            - 'city_no'
        ),
        true
      ),
      '{variantAttributes}',
      (
        COALESCE(sp.attributes->'variantAttributes', '{}'::jsonb)
          - 'cityCode'
          - 'city_code'
          - 'cityNo'
          - 'city_no'
      ),
      true
    ),
    '{snapshot}',
    (
      CASE
        WHEN jsonb_typeof(sp.attributes->'snapshot') = 'object' THEN
          (sp.attributes->'snapshot')
            - 'cityCode'
            - 'city_code'
            - 'cityNo'
            - 'city_no'
        ELSE COALESCE(sp.attributes->'snapshot', 'null'::jsonb)
      END
    ),
    true
  )
)
WHERE sp.attributes IS NOT NULL;

-- 2) Recompute variant_key without cityCode (aligned with backend identity logic).
UPDATE supplier_products sp
SET variant_key = encode(
  digest(
    jsonb_build_object(
      'brandModel', lower(trim(COALESCE(sp.attributes->>'brandModel', ''))),
      'gtin', trim(COALESCE(sp.attributes->>'gtin', '')),
      'mpn', trim(COALESCE(sp.attributes->>'mpn', COALESCE(sp.attributes->>'modelNumber', sp.attributes->>'model_no', ''))),
      'sku', trim(COALESCE(sp.attributes->>'sku', sp.attributes->>'skuNo', sp.attributes->>'gsku', '')),
      'unit', lower(trim(COALESCE(sp.attributes->>'unit', ''))),
      'packSize', lower(trim(COALESCE(sp.attributes->>'packSize', sp.attributes->>'pack_size', ''))),
      'variantAttributes',
      COALESCE(
        (
          SELECT jsonb_object_agg(lower(trim(k)), lower(trim(btrim(v::text, '"'))))
          FROM jsonb_each(COALESCE(sp.attributes->'specifications', '{}'::jsonb)) e(k, v)
          WHERE v IS NOT NULL AND trim(btrim(v::text, '"')) <> ''
        ),
        '{}'::jsonb
      )
    )::text,
    'sha256'
  ),
  'hex'
);

-- 3) Ensure no blank variant_key values remain.
UPDATE supplier_products sp
SET variant_key = encode(digest(sp.id::text, 'sha256'), 'hex')
WHERE sp.variant_key IS NULL OR btrim(sp.variant_key) = '';

-- 4) Resolve collisions deterministically.
WITH ranked AS (
  SELECT
    id,
    product_id,
    supplier_id,
    location,
    variant_key,
    row_number() OVER (
      PARTITION BY product_id, supplier_id, location, variant_key
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM supplier_products
)
UPDATE supplier_products sp
SET variant_key = encode(digest(sp.variant_key || ':' || sp.id::text, 'sha256'), 'hex')
FROM ranked r
WHERE sp.id = r.id
  AND r.rn > 1;

-- 5) Recompute variant_asin from parent ASIN + new variant_key.
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
WHERE p.id = sp.product_id;

-- 6) Safety fallback for blank variant_asin values.
UPDATE supplier_products sp
SET variant_asin = upper(substr(encode(digest(sp.id::text, 'sha256'), 'hex'), 1, 12))
WHERE sp.variant_asin IS NULL OR btrim(sp.variant_asin) = '';

COMMIT;

-- Optional verification queries (run manually):
-- SELECT id FROM supplier_products
-- WHERE attributes::text ~* '(citycode|city_code|cityno|city_no)';
--
-- SELECT product_id, supplier_id, location, variant_key, COUNT(*)
-- FROM supplier_products
-- GROUP BY 1,2,3,4
-- HAVING COUNT(*) > 1;
