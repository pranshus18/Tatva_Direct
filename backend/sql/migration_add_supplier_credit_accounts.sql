-- ============================================
-- MIGRATION: Supplier credit on account (pay later)
-- ============================================
-- Per-supplier credit limits for B2B buyers (users) and B2C POS customers (phone).
-- Safe to run multiple times.
-- Then run migration_add_paylater_threshold.sql for the pay-later minimum order column.

CREATE TABLE IF NOT EXISTS supplier_credit_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  customer_phone VARCHAR(20),
  credit_limit DECIMAL(14, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  credit_period_days INTEGER NOT NULL DEFAULT 30 CHECK (credit_period_days > 0),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT supplier_credit_party_required CHECK (
    buyer_user_id IS NOT NULL
    OR customer_id IS NOT NULL
    OR (customer_phone IS NOT NULL AND TRIM(customer_phone) <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credit_buyer
  ON supplier_credit_accounts (supplier_id, buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credit_customer
  ON supplier_credit_accounts (supplier_id, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credit_phone
  ON supplier_credit_accounts (supplier_id, customer_phone)
  WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) <> '';

CREATE INDEX IF NOT EXISTS idx_supplier_credit_supplier
  ON supplier_credit_accounts (supplier_id);

DROP TRIGGER IF EXISTS update_supplier_credit_accounts_updated_at ON supplier_credit_accounts;
CREATE TRIGGER update_supplier_credit_accounts_updated_at
  BEFORE UPDATE ON supplier_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
