-- Allow order deletion without FK violations on notifications.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_related_order_id_fkey;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_related_order_id_fkey
  FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL;
