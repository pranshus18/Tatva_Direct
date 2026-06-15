-- ============================================
-- MIGRATION: Wallet withdrawal requests + bank accounts
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- wallet_bank_accounts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_holder_name TEXT,
  bank_name TEXT,
  account_number TEXT,
  ifsc_code TEXT,
  upi_id TEXT,
  notes TEXT,
  is_default BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_bank_accounts_user
  ON wallet_bank_accounts(user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_bank_accounts_default
  ON wallet_bank_accounts(user_id)
  WHERE is_default = true AND is_active = true;

-- ------------------------------------------------------------
-- wallet_withdrawal_requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'failed', 'cancelled')),
  note TEXT,
  idempotency_key VARCHAR(150) UNIQUE,
  bank_account_id UUID REFERENCES wallet_bank_accounts(id) ON DELETE SET NULL,
  requested_balance_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  payout_reference VARCHAR(120),
  transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_wallet_status
  ON wallet_withdrawal_requests(wallet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user_status
  ON wallet_withdrawal_requests(user_id, status, created_at DESC);
