-- Replace legacy payment_method 'wallet' with 'vault' (PM vault checkout).
-- Safe to re-run.

DO $$
BEGIN
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'vault', 'wallet'));
END $$;

DO $$
BEGIN
  ALTER TABLE payment_receipts
    DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;
  ALTER TABLE payment_receipts
    ADD CONSTRAINT payment_receipts_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'vault', 'wallet'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE payment_transactions
    DROP CONSTRAINT IF EXISTS payment_transactions_method_check;
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_method_check
    CHECK (method IN ('upi', 'bank_transfer', 'card', 'netbanking', 'credit_line', 'vault', 'wallet'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

UPDATE orders
SET payment_method = 'vault'
WHERE lower(coalesce(payment_method, '')) = 'wallet';

UPDATE payment_receipts
SET payment_method = 'vault'
WHERE lower(coalesce(payment_method, '')) = 'wallet';

UPDATE payment_transactions
SET method = 'vault'
WHERE lower(coalesce(method, '')) = 'wallet';

-- Tighten CHECKs: vault only (no wallet) after backfill.
DO $$
BEGIN
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'vault'));
END $$;

DO $$
BEGIN
  ALTER TABLE payment_receipts
    DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;
  ALTER TABLE payment_receipts
    ADD CONSTRAINT payment_receipts_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'vault'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE payment_transactions
    DROP CONSTRAINT IF EXISTS payment_transactions_method_check;
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_method_check
    CHECK (method IN ('upi', 'bank_transfer', 'card', 'netbanking', 'credit_line', 'vault'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;
