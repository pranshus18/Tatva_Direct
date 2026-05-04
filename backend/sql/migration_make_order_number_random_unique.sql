-- ============================================
-- MIGRATION: Make order_number random + globally unique
-- ============================================
-- Purpose:
-- - Replace date+counter order numbers with random order numbers
-- - Keep global uniqueness across all suppliers via existing UNIQUE(order_number)
-- - Avoid predictable sequential values
-- ============================================

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
    candidate VARCHAR(50);
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        LOOP
            candidate := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
              UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || COALESCE(NEW.id::TEXT, '')), 1, 10));
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM orders WHERE order_number = candidate
            );
        END LOOP;
        NEW.order_number := candidate;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION generate_order_number();

-- Optional sanity check:
-- INSERT INTO orders (...) VALUES (...); then verify order_number like ORD-YYYYMMDD-XXXXXXXXXX
