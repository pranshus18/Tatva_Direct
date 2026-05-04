-- ============================================
-- MIGRATION: Add order returns workflow
-- ============================================

CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  service_provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  tracking_id VARCHAR(80),
  status VARCHAR(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'picked_up', 'received', 'refunded', 'replaced', 'closed')),
  supplier_notes TEXT,
  metadata JSONB DEFAULT '{}',
  status_history JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_supplier ON order_returns(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_returns_service_provider ON order_returns(service_provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_returns_status ON order_returns(status);

DROP TRIGGER IF EXISTS update_order_returns_updated_at ON order_returns;
CREATE TRIGGER update_order_returns_updated_at
  BEFORE UPDATE ON order_returns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
