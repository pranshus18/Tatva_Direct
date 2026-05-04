-- ============================================
-- MIGRATION: Backfill families and variants
-- ============================================
-- Safe, idempotent backfill from products + supplier_products

WITH base_products AS (
  SELECT
    p.id AS product_id,
    COALESCE(NULLIF(lower(trim(p.brand)), ''), 'unknown') AS brand_norm,
    COALESCE(NULLIF(lower(trim(p.category)), ''), 'uncategorized') AS category_norm,
    COALESCE(NULLIF(lower(trim(p.name)), ''), 'unknown') AS name_norm,
    p.name,
    p.brand,
    p.category
  FROM products p
),
families AS (
  SELECT
    product_id,
    encode(
      digest(
        jsonb_build_object(
          'brand', brand_norm,
          'category', category_norm,
          'name', name_norm
        )::text,
        'sha256'
      ),
      'hex'
    ) AS family_key,
    name,
    brand,
    category
  FROM base_products
),
inserted_families AS (
  INSERT INTO product_families (canonical_name, brand, category, normalized_family_key, status)
  SELECT DISTINCT
    name,
    brand,
    category,
    family_key,
    'active'
  FROM families
  ON CONFLICT (normalized_family_key) DO NOTHING
  RETURNING id, normalized_family_key
)
UPDATE products p
SET family_id = pf.id
FROM families f
JOIN product_families pf
  ON pf.normalized_family_key = f.family_key
WHERE p.id = f.product_id
  AND (p.family_id IS NULL OR p.family_id <> pf.id);

WITH source_variants AS (
  SELECT
    sp.id AS supplier_product_id,
    sp.product_id,
    p.family_id,
    COALESCE(NULLIF(sp.variant_key, ''), encode(digest(sp.id::text, 'sha256'), 'hex')) AS variant_key,
    sp.variant_asin,
    COALESCE(NULLIF(p.gtin, ''), NULLIF(sp.attributes->>'gtin', '')) AS gtin,
    COALESCE(NULLIF(p.mpn, ''), NULLIF(sp.attributes->>'mpn', '')) AS mpn,
    COALESCE(NULLIF(p.brand, ''), NULLIF(sp.attributes->>'brand', '')) AS brand,
    p.unit,
    COALESCE(NULLIF(sp.attributes->>'packSize', ''), NULLIF(sp.attributes->>'pack_size', '')) AS pack_size,
    COALESCE(sp.attributes->'variantAttributes', p.specifications, '{}'::jsonb) AS attrs
  FROM supplier_products sp
  JOIN products p ON p.id = sp.product_id
  WHERE p.family_id IS NOT NULL
),
insert_variants AS (
  INSERT INTO product_variants (
    family_id,
    product_id,
    variant_name,
    variant_key,
    variant_asin,
    gtin,
    mpn,
    brand,
    unit,
    pack_size,
    canonical_attributes,
    status
  )
  SELECT DISTINCT
    sv.family_id,
    sv.product_id,
    NULL,
    sv.variant_key,
    sv.variant_asin,
    sv.gtin,
    sv.mpn,
    sv.brand,
    sv.unit,
    sv.pack_size,
    sv.attrs,
    CASE WHEN EXISTS (
      SELECT 1 FROM products p2 WHERE p2.id = sv.product_id AND p2.status = 'approved'
    ) THEN 'approved' ELSE 'review_pending' END
  FROM source_variants sv
  ON CONFLICT (family_id, variant_key) DO NOTHING
  RETURNING id, family_id, variant_key
)
UPDATE supplier_products sp
SET product_variant_id = pv.id
FROM products p
JOIN product_variants pv
  ON pv.family_id = p.family_id
 AND pv.variant_key = COALESCE(NULLIF(sp.variant_key, ''), encode(digest(sp.id::text, 'sha256'), 'hex'))
WHERE p.id = sp.product_id
  AND sp.product_id = p.id
  AND (sp.product_variant_id IS NULL OR sp.product_variant_id <> pv.id);

UPDATE products p
SET variant_id = pv.id
FROM product_variants pv
WHERE p.id = pv.product_id
  AND (p.variant_id IS NULL OR p.variant_id <> pv.id);
