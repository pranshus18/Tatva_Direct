-- ============================================
-- MIGRATION: Add transport confirmation timestamp on orders
-- ============================================
-- Purpose:
-- - Allow operations/logistics modules to filter orders where
--   transport has been finalized by service provider.
-- - Keep this independent from status_history parsing.
--
-- Safe to run multiple times.
-- ============================================

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS transport_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_transport_confirmed_at
ON orders(transport_confirmed_at)
WHERE transport_confirmed_at IS NOT NULL;

