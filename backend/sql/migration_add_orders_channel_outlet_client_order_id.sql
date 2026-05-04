-- ============================================
-- MIGRATION: Add channel/outlet_id + idempotency key for POS offline sync
-- ============================================
-- Purpose:
-- - Support offline vs online channel tracking on orders
-- - Link POS sales to an outlet
-- - Allow safe re-sync of queued offline orders without duplicates (client_order_id)
--
-- Safe to run multiple times.
-- ============================================

-- 1) Channel for analytics + separation of offline_sale vs b2b_po etc.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS channel VARCHAR(30) DEFAULT 'b2b_po';

-- 2) Outlet linkage for POS / offline_sale
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS outlet_id UUID REFERENCES outlets(id) ON DELETE SET NULL;

-- 3) Idempotency key for syncing queued offline orders from devices
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS client_order_id UUID;

-- Add/check constraint for channel values (only if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_channel_check_v1'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_channel_check_v1
      CHECK (channel IN ('b2b_po', 'online_sale', 'offline_sale'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_outlet ON orders(outlet_id);

-- client_order_id must be globally unique when present (prevents duplicate sync)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_order_id_unique
  ON orders(client_order_id)
  WHERE client_order_id IS NOT NULL;

