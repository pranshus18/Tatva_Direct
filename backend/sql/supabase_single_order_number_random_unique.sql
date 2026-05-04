-- ============================================
-- SINGLE-RUN SUPABASE SQL
-- Make order numbers random + globally unique
-- ============================================
-- What this does:
-- 1) Ensures orders.order_number has UNIQUE constraint
-- 2) Replaces trigger function to generate random order numbers
-- 3) Recreates trigger on orders table
--
-- New format:
-- ORD-DDMMMYYYY-XXXXXXXX
-- Example: ORD-29APR2026-A1B2C3D4
-- ============================================

-- 1) Ensure unique constraint exists (global uniqueness across all suppliers)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_order_number_key'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
  END IF;
END $$;

-- 2) Replace order number generator function
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  candidate VARCHAR(50);
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    LOOP
      candidate := 'ORD-' || UPPER(TO_CHAR(NOW(), 'DDMonYYYY')) || '-' ||
        UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || COALESCE(NEW.id::TEXT, '')), 1, 8));

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM orders WHERE order_number = candidate
      );
    END LOOP;

    NEW.order_number := candidate;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Recreate trigger
DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION generate_order_number();

-- Optional quick verification (run separately if you want):
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'orders'::regclass AND NOT tgisinternal;
