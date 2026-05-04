-- ============================================
-- MIGRATION: Phase 2 B2B Core Best-in-Class
-- ============================================
-- Adds schema primitives for:
-- - catalog quality signals
-- - inventory reservations + warehouse allocation
-- - order state machine + SLA escalations
-- - returns policy + partial returns + restocking
-- - vendor scorecard snapshots
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Catalog intelligence
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attribute_completeness_score NUMERIC(5,2) DEFAULT 0 CHECK (attribute_completeness_score >= 0 AND attribute_completeness_score <= 100),
  ADD COLUMN IF NOT EXISTS duplicate_of_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_confidence NUMERIC(5,2) CHECK (duplicate_confidence >= 0 AND duplicate_confidence <= 100),
  ADD COLUMN IF NOT EXISTS normalization_confidence NUMERIC(5,2) CHECK (normalization_confidence >= 0 AND normalization_confidence <= 100),
  ADD COLUMN IF NOT EXISTS normalization_last_reviewed_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_products_duplicate_of ON products(duplicate_of_product_id);
CREATE INDEX IF NOT EXISTS idx_products_attr_completeness ON products(attribute_completeness_score);

-- 2) Reservation + allocation
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key VARCHAR(120) UNIQUE,
  supplier_product_id UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  reserved_quantity INTEGER NOT NULL CHECK (reserved_quantity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_supplier_product
  ON inventory_reservations(supplier_product_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expires_at
  ON inventory_reservations(expires_at);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_product_id UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_code VARCHAR(60) NOT NULL,
  on_hand_qty INTEGER NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
  reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  allocation_priority INTEGER NOT NULL DEFAULT 100,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (supplier_product_id, warehouse_code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_supplier_product
  ON warehouse_stock(supplier_product_id, allocation_priority);

-- 3) Order state machine + SLA
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(24),
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state_machine_version INTEGER DEFAULT 1;

UPDATE orders
SET lifecycle_state = COALESCE(lifecycle_state, status)
WHERE lifecycle_state IS NULL;

ALTER TABLE orders
  ALTER COLUMN lifecycle_state SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_orders_lifecycle_state ON orders(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_orders_sla_due_at ON orders(sla_due_at);

CREATE TABLE IF NOT EXISTS order_sla_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type VARCHAR(24) NOT NULL
    CHECK (event_type IN ('scheduled', 'warning', 'breach', 'escalated', 'resolved')),
  triggered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_order_sla_events_order
  ON order_sla_events(order_id, triggered_at DESC);

-- 4) Returns policy + partial returns
ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS disposition VARCHAR(24)
    CHECK (disposition IN ('restock', 'scrap', 'repair', 'replace', 'pending')),
  ADD COLUMN IF NOT EXISTS restocked_quantity NUMERIC(10,2) DEFAULT 0 CHECK (restocked_quantity >= 0),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- 5) Vendor scorecard snapshots
CREATE TABLE IF NOT EXISTS vendor_scorecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  on_time_orders INTEGER NOT NULL DEFAULT 0,
  fill_rate NUMERIC(6,2) DEFAULT 0,
  avg_lead_time_hours NUMERIC(10,2) DEFAULT 0,
  price_variance_pct NUMERIC(8,2) DEFAULT 0,
  return_rate_pct NUMERIC(8,2) DEFAULT 0,
  score NUMERIC(6,2) DEFAULT 0,
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (supplier_id, week_start, week_end)
);

CREATE INDEX IF NOT EXISTS idx_vendor_scorecards_supplier_week
  ON vendor_scorecards(supplier_id, week_start DESC);
