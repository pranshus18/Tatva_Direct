-- ============================================
-- MIGRATION: Wallet system + dynamic platform fees by supply chain role
-- ============================================
-- Adds:
-- - wallets
-- - wallet_transactions
-- - wallet_topups
-- - supplier_payouts
-- - supply_chain_platform_fees (admin-managed brand x role fee matrix)
-- - order columns for wallet and fee snapshots
-- - payment method/check updates to include 'wallet'

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- wallets
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_type VARCHAR(30) NOT NULL CHECK (wallet_type IN (
    'customer', 'supplier', 'platform_escrow', 'platform_revenue'
  )),
  balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_type_unique
  ON wallets (user_id, wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallets_user
  ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_type
  ON wallets(wallet_type);

-- Allow exactly one row per platform wallet type (no user_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_platform_unique
  ON wallets(wallet_type)
  WHERE user_id IS NULL AND wallet_type IN ('platform_escrow', 'platform_revenue');

-- ------------------------------------------------------------
-- wallet_transactions (immutable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN (
    'topup', 'order_payment', 'order_hold', 'escrow_release',
    'platform_fee', 'supplier_payout', 'refund', 'withdrawal', 'adjustment'
  )),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_before NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  reference_type VARCHAR(50),
  reference_id VARCHAR(120),
  idempotency_key VARCHAR(150) UNIQUE,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet
  ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_ref
  ON wallet_transactions(reference_type, reference_id);

-- ------------------------------------------------------------
-- wallet_topups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  idempotency_key VARCHAR(150) UNIQUE,
  razorpay_order_id VARCHAR(120),
  razorpay_payment_id VARCHAR(120),
  provider_signature VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_user
  ON wallet_topups(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_status
  ON wallet_topups(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_rp_order
  ON wallet_topups(razorpay_order_id);

-- ------------------------------------------------------------
-- Dynamic platform fees by supply chain level
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_chain_platform_fees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_name TEXT,
  normalized_brand TEXT,
  supply_chain_role VARCHAR(40) NOT NULL CHECK (supply_chain_role IN (
    'manufacturer', 'stockist', 'regional_distributor',
    'local_distributor', 'dealer', 'retailer'
  )),
  fee_type VARCHAR(20) NOT NULL CHECK (fee_type IN ('percentage', 'fixed')),
  fee_value NUMERIC(10,2) NOT NULL CHECK (fee_value >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_platform_fees_role
  ON supply_chain_platform_fees(supply_chain_role);
CREATE INDEX IF NOT EXISTS idx_sc_platform_fees_brand
  ON supply_chain_platform_fees(normalized_brand);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sc_platform_fees_brand_role_active
  ON supply_chain_platform_fees (
    COALESCE(NULLIF(BTRIM(normalized_brand), ''), '__all__'),
    supply_chain_role
  )
  WHERE is_active = true AND effective_to IS NULL;

-- ------------------------------------------------------------
-- supplier_payouts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
  platform_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (platform_fee_amount >= 0),
  net_amount NUMERIC(12,2) NOT NULL CHECK (net_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'paid_out', 'failed', 'cancelled')),
  released_at TIMESTAMPTZ,
  paid_out_at TIMESTAMPTZ,
  bank_reference VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payouts_supplier_status
  ON supplier_payouts(supplier_id, status, created_at DESC);

-- ------------------------------------------------------------
-- orders: wallet + fee snapshot columns
-- ------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_payout_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS wallet_payment_status VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS supply_chain_role_at_payment VARCHAR(40),
  ADD COLUMN IF NOT EXISTS platform_fee_breakdown JSONB NOT NULL DEFAULT '[]';

DO $$
BEGIN
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_wallet_payment_status_check;
  ALTER TABLE orders
    ADD CONSTRAINT orders_wallet_payment_status_check
    CHECK (wallet_payment_status IN ('none', 'held', 'released', 'refunded'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ------------------------------------------------------------
-- payment method constraints now include wallet
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'wallet'));
END $$;

DO $$
BEGIN
  ALTER TABLE payment_receipts
    DROP CONSTRAINT IF EXISTS payment_receipts_payment_method_check;
  ALTER TABLE payment_receipts
    ADD CONSTRAINT payment_receipts_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'wallet'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE payment_transactions
    DROP CONSTRAINT IF EXISTS payment_transactions_method_check;
  ALTER TABLE payment_transactions
    ADD CONSTRAINT payment_transactions_method_check
    CHECK (method IN ('upi', 'bank_transfer', 'card', 'netbanking', 'credit_line', 'wallet'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- ------------------------------------------------------------
-- bootstrap platform wallets (idempotent)
-- ------------------------------------------------------------
INSERT INTO wallets (user_id, wallet_type, balance, currency, metadata)
SELECT NULL, 'platform_escrow', 0, 'INR', '{"seededBy":"migration_wallet_system"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM wallets WHERE user_id IS NULL AND wallet_type = 'platform_escrow'
);

INSERT INTO wallets (user_id, wallet_type, balance, currency, metadata)
SELECT NULL, 'platform_revenue', 0, 'INR', '{"seededBy":"migration_wallet_system"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM wallets WHERE user_id IS NULL AND wallet_type = 'platform_revenue'
);

-- ------------------------------------------------------------
-- bootstrap role defaults using env fallback equivalent (editable in admin UI)
-- ------------------------------------------------------------
INSERT INTO supply_chain_platform_fees (
  brand_name, normalized_brand, supply_chain_role, fee_type, fee_value, is_active, notes
)
SELECT * FROM (
  VALUES
    (NULL, NULL, 'manufacturer', 'percentage', 1.50, true, 'Seed default role fee'),
    (NULL, NULL, 'stockist', 'percentage', 2.00, true, 'Seed default role fee'),
    (NULL, NULL, 'regional_distributor', 'percentage', 2.50, true, 'Seed default role fee'),
    (NULL, NULL, 'local_distributor', 'percentage', 3.00, true, 'Seed default role fee'),
    (NULL, NULL, 'dealer', 'percentage', 4.00, true, 'Seed default role fee'),
    (NULL, NULL, 'retailer', 'percentage', 5.00, true, 'Seed default role fee')
) AS seed(brand_name, normalized_brand, supply_chain_role, fee_type, fee_value, is_active, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM supply_chain_platform_fees f
  WHERE f.is_active = true
    AND f.effective_to IS NULL
    AND f.normalized_brand IS NULL
    AND f.supply_chain_role = seed.supply_chain_role
);
