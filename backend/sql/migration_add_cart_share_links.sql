-- ============================================
-- MIGRATION: Cart Share Links (token-based)
-- ============================================

CREATE TABLE IF NOT EXISTS cart_share_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cart_mode TEXT,
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_cart_share_links_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_cart_share_links_token
  ON cart_share_links(token);

CREATE INDEX IF NOT EXISTS idx_cart_share_links_expires_at
  ON cart_share_links(expires_at);

DROP TRIGGER IF EXISTS update_cart_share_links_updated_at ON cart_share_links;
CREATE TRIGGER update_cart_share_links_updated_at
  BEFORE UPDATE ON cart_share_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

