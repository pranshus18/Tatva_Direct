-- ============================================
-- MIGRATION: Add outlets (physical stores/warehouses)
-- ============================================
-- Purpose:
-- - Normalize supplier branches / outlets instead of using free-text locations
-- - Prepare for per-outlet inventory and POS tracking
--
-- This migration is additive and non-breaking:
-- - It creates a new outlets table
-- - It does NOT yet enforce outlet_id everywhere (optional FK for now)
-- ============================================

CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) DEFAULT 'store' CHECK (type IN ('store', 'warehouse', 'office')),
  code VARCHAR(50), -- optional human-readable code (e.g. "BLR-01")
  address JSONB DEFAULT '{}', -- {street, city, state, zipCode, country}
  geo_location JSONB DEFAULT NULL, -- {lat, lng}
  phone VARCHAR(20),
  email VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlets_supplier ON outlets(supplier_id);
CREATE INDEX IF NOT EXISTS idx_outlets_is_active ON outlets(is_active);

-- Reuse global updated_at trigger function if present
DROP TRIGGER IF EXISTS update_outlets_updated_at ON outlets;
CREATE TRIGGER update_outlets_updated_at
  BEFORE UPDATE ON outlets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

