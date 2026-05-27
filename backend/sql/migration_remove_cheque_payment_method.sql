-- Remove cheque as an allowed payment method on orders and payment_receipts

UPDATE orders
SET payment_method = 'bank_transfer'
WHERE payment_method = 'cheque';

UPDATE payment_receipts
SET payment_method = 'bank_transfer'
WHERE payment_method = 'cheque';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card'));

ALTER TABLE payment_receipts
  DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;

ALTER TABLE payment_receipts
  ADD CONSTRAINT payment_receipts_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card'));
