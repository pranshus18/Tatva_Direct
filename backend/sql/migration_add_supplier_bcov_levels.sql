-- ============================================
-- MIGRATION: Supplier BCOV Levels
-- Brand-wise quantity slabs with resolved unit price
-- ============================================

CREATE TABLE IF NOT EXISTS supplier_bcov_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_name VARCHAR(120) NOT NULL,
  normalized_brand VARCHAR(140) NOT NULL,
  min_purchase_qty NUMERIC(12,2) NOT NULL CHECK (min_purchase_qty >= 0),
  max_purchase_qty NUMERIC(12,2) CHECK (max_purchase_qty IS NULL OR max_purchase_qty > min_purchase_qty),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_supplier
  ON supplier_bcov_levels(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_brand
  ON supplier_bcov_levels(supplier_id, normalized_brand);

CREATE INDEX IF NOT EXISTS idx_supplier_bcov_levels_qty
  ON supplier_bcov_levels(supplier_id, normalized_brand, min_purchase_qty);

DROP TRIGGER IF EXISTS update_supplier_bcov_levels_updated_at ON supplier_bcov_levels;
CREATE TRIGGER update_supplier_bcov_levels_updated_at
  BEFORE UPDATE ON supplier_bcov_levels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
