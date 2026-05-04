-- Pending / approved supplier supply-chain profile (role + brands per entry)
-- Run in Supabase SQL editor after brands migration.

CREATE TABLE IF NOT EXISTS supplier_chain_profile_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scpr_user ON supplier_chain_profile_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_scpr_status ON supplier_chain_profile_requests(status);
CREATE INDEX IF NOT EXISTS idx_scpr_created ON supplier_chain_profile_requests(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scpr_one_pending_per_user
  ON supplier_chain_profile_requests (user_id)
  WHERE (status = 'pending');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_scpr_updated_at'
  ) THEN
    CREATE TRIGGER update_scpr_updated_at BEFORE UPDATE ON supplier_chain_profile_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
