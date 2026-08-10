-- ============================================
-- MIGRATION: Enforce single MRP per catalog variant
-- ============================================
-- Rule:
-- For the same product_id + variant_key, all non-rejected supplier offers
-- must use the same price (MRP). Admin may change it; suppliers cannot diverge.

CREATE OR REPLACE FUNCTION enforce_supplier_variant_mrp_lock()
RETURNS trigger AS $$
DECLARE
  existing_price NUMERIC(12,2);
  variant_key_value TEXT;
BEGIN
  IF NEW.price IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, '')) = 'rejected' THEN
    RETURN NEW;
  END IF;

  variant_key_value := NULLIF(trim(COALESCE(NEW.variant_key, '')), '');
  IF variant_key_value IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.price := round(NEW.price::numeric, 2);

  SELECT round(sp.price::numeric, 2)
    INTO existing_price
  FROM supplier_products sp
  WHERE sp.product_id = NEW.product_id
    AND sp.variant_key = variant_key_value
    AND lower(COALESCE(sp.status, '')) <> 'rejected'
    AND sp.price IS NOT NULL
    AND sp.price > 0
    AND (NEW.id IS NULL OR sp.id <> NEW.id)
  ORDER BY
    CASE
      WHEN lower(COALESCE(sp.status, '')) = 'approved' AND sp.is_active = true THEN 0
      WHEN lower(COALESCE(sp.status, '')) = 'approved' THEN 1
      ELSE 2
    END,
    sp.updated_at ASC NULLS LAST,
    sp.created_at ASC NULLS LAST
  LIMIT 1;

  IF existing_price IS NOT NULL AND NEW.price <> existing_price THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'MRP is locked for this variant. Use %s for all suppliers.',
          to_char(existing_price, 'FM9999999990.00')
        );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_supplier_variant_price_lock ON supplier_products;
DROP TRIGGER IF EXISTS trg_enforce_supplier_variant_mrp_lock ON supplier_products;

CREATE TRIGGER trg_enforce_supplier_variant_mrp_lock
BEFORE INSERT OR UPDATE OF product_id, variant_key, price, status
ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION enforce_supplier_variant_mrp_lock();
