-- ============================================
-- MIGRATION: Add inventory_movements (inventory ledger)
-- ============================================
-- Purpose:
-- - Track every stock change event for supplier_products
-- - Prepare for Walmart-style traceability across online + offline channels
--
-- This is additive and non-breaking.
-- ============================================

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_product_id UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_change INTEGER NOT NULL, -- positive = stock in, negative = stock out
  movement_type VARCHAR(30) NOT NULL CHECK (
    movement_type IN (
      'sale_online',
      'sale_offline',
      'return_sale',
      'purchase',
      'return_purchase',
      'adjustment',
      'transfer_in',
      'transfer_out'
    )
  ),
  reference_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  reference_order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_supplier_product
  ON inventory_movements(supplier_product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_supplier
  ON inventory_movements(supplier_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
  ON inventory_movements(product_id);

