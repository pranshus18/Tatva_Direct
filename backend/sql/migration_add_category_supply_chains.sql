-- Admin-defined typical supply chain per product category (aligns with supplier profile roles).
-- Run in Supabase SQL editor after prior migrations.

CREATE TABLE IF NOT EXISTS category_supply_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT NOT NULL,
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  ai_suggested_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_supply_chains_name_unique
  ON category_supply_chains (lower(trim(category_name)));

CREATE INDEX IF NOT EXISTS idx_category_supply_chains_updated
  ON category_supply_chains (updated_at DESC);

COMMENT ON TABLE category_supply_chains IS 'Ordered supply chain stages per category (roles: manufacturer..retailer). Used by admin portal; optional reference for suppliers.';
