-- ============================================
-- MIGRATION: Add credit_note payment method
-- ============================================

-- Update orders table payment_method constraint
DO $$
BEGIN
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_check;

  ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'online', 'credit', 'credit_note', 'upi', 'card'));
END $$;

-- Update payment_receipts table payment_method constraint
DO $$
BEGIN
  ALTER TABLE payment_receipts
    DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;

  ALTER TABLE payment_receipts
    ADD CONSTRAINT payment_receipts_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'online', 'credit', 'credit_note', 'upi', 'card'));
END $$;
