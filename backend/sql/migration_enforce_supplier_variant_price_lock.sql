-- ============================================
-- MIGRATION: Enforce single MRP per product
-- ============================================
-- Rule:
-- For the same product_id, all non-rejected supplier offers (all variants)
-- must use the same price (MRP). This protects consistency even for direct DB writes.

CREATE OR REPLACE FUNCTION enforce_supplier_variant_price_lock()
RETURNS trigger AS $$
DECLARE
  existing_price NUMERIC(12,2);
BEGIN
  IF NEW.price IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, '')) = 'rejected' THEN
    RETURN NEW;
  END IF;

  -- Keep persisted values in 2-decimal currency format.
  NEW.price := round(NEW.price::numeric, 2);

  -- Find existing locked price for this product from non-rejected rows.
  SELECT round(sp.price::numeric, 2)
    INTO existing_price
  FROM supplier_products sp
  WHERE sp.product_id = NEW.product_id
    AND lower(COALESCE(sp.status, '')) <> 'rejected'
    AND sp.price IS NOT NULL
    AND (NEW.id IS NULL OR sp.id <> NEW.id)
  ORDER BY
    CASE WHEN lower(COALESCE(sp.status, '')) = 'approved' AND sp.is_active = true THEN 0 ELSE 1 END,
    sp.updated_at ASC NULLS LAST,
    sp.created_at ASC NULLS LAST
  LIMIT 1;

  IF existing_price IS NOT NULL AND NEW.price <> existing_price THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'MRP is locked for this product. Use %s for all suppliers and variants.',
          to_char(existing_price, 'FM9999999990.00')
        );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_supplier_variant_price_lock ON supplier_products;
CREATE TRIGGER trg_enforce_supplier_variant_price_lock
BEFORE INSERT OR UPDATE OF product_id, price, status
ON supplier_products
FOR EACH ROW
EXECUTE FUNCTION enforce_supplier_variant_price_lock();
