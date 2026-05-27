-- Extend notifications.type for credit limit alerts
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'payment_received',
    'payment_receipt',
    'order_status',
    'product_approval',
    'system',
    'supplier_edit',
    'product_update',
    'credit_limit'
  ));
