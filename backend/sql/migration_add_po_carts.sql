-- ============================================
-- MIGRATION: Service Provider PO Cart Drafts
-- ============================================

CREATE TABLE IF NOT EXISTS po_carts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_po_carts_service_provider UNIQUE (service_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_po_carts_service_provider
  ON po_carts(service_provider_id);

DROP TRIGGER IF EXISTS update_po_carts_updated_at ON po_carts;
CREATE TRIGGER update_po_carts_updated_at
  BEFORE UPDATE ON po_carts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
