-- ============================================
-- MIGRATION: Add UPI and Card payment methods
-- ============================================
-- Purpose:
-- - Add 'upi' and 'card' to allowed payment methods
-- - These are common payment methods in India for offline POS
-- ============================================

-- Update orders table payment_method constraint
DO $$
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  
  -- Add new constraint with UPI and Card
  ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card'));
END $$;

-- Update payment_receipts table payment_method constraint
DO $$
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE payment_receipts
    DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;
  
  -- Add new constraint with UPI and Card
  ALTER TABLE payment_receipts
    ADD CONSTRAINT payment_receipts_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card'));
END $$;

-- Verify the constraints
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname IN ('orders_payment_method_check', 'payment_receipts_payment_method_check')
  AND conrelid IN (
    'orders'::regclass,
    'payment_receipts'::regclass
  );
