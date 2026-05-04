-- Updates order number format to: ORD + DDMMYYYY + 4-digit daily counter
-- Example: ORD240420260001

CREATE TABLE IF NOT EXISTS order_number_counters (
  order_date DATE PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  date_key DATE;
  date_token TEXT;
  next_counter INTEGER;
  order_num VARCHAR(50);
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    date_key := CURRENT_DATE;
    date_token := TO_CHAR(date_key, 'DDMMYYYY');

    INSERT INTO order_number_counters (order_date, last_value, updated_at)
    VALUES (date_key, 1, NOW())
    ON CONFLICT (order_date)
    DO UPDATE SET
      last_value = order_number_counters.last_value + 1,
      updated_at = NOW()
    RETURNING last_value INTO next_counter;

    order_num := 'ORD' || date_token || LPAD(next_counter::TEXT, 4, '0');
    NEW.order_number := order_num;
  END IF;

  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION generate_order_number();
