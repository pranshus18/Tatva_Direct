-- ============================================
-- MIGRATION: Phase 3 Transaction Confidence
-- ============================================
-- Razorpay integration, webhook events, reconciliation, risk, and immutable audit logs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_provider_order_id VARCHAR(120) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_provider_payment_id VARCHAR(120) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS credit_line_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_orders_payment_provider_order_id
  ON orders(payment_provider_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_provider_payment_id
  ON orders(payment_provider_payment_id);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(30) NOT NULL DEFAULT 'razorpay',
  method VARCHAR(30) NOT NULL CHECK (method IN ('upi', 'bank_transfer', 'card', 'netbanking', 'credit_line')),
  transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN ('payment', 'refund', 'payout', 'settlement')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  provider_order_id VARCHAR(120),
  provider_payment_id VARCHAR(120),
  provider_signature VARCHAR(255),
  status VARCHAR(24) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'pending', 'refunded', 'settled', 'cancelled')),
  idempotency_key VARCHAR(120),
  retries INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order
  ON payment_transactions(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status
  ON payment_transactions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(30) NOT NULL DEFAULT 'razorpay',
  event_type VARCHAR(120) NOT NULL,
  provider_event_id VARCHAR(150),
  signature VARCHAR(255),
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  processing_error TEXT,
  received_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON payment_webhook_events(processing_status, received_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type VARCHAR(30) NOT NULL CHECK (run_type IN ('payment_receipt', 'ledger', 'settlement', 'invoice')),
  from_date TIMESTAMP,
  to_date TIMESTAMP,
  total_checked INTEGER NOT NULL DEFAULT 0,
  mismatched_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'failed')),
  summary JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reconciliation_run_id UUID REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  issue_type VARCHAR(30) NOT NULL CHECK (issue_type IN ('missing_receipt', 'missing_invoice', 'ledger_mismatch', 'amount_mismatch', 'missing_payment_txn')),
  severity VARCHAR(15) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  expected_value JSONB DEFAULT '{}',
  actual_value JSONB DEFAULT '{}',
  status VARCHAR(15) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_issues_status
  ON reconciliation_issues(status, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  signal_type VARCHAR(40) NOT NULL CHECK (signal_type IN ('velocity', 'amount_spike', 'supplier_risk', 'buyer_risk', 'suspicious_pattern')),
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'blocked', 'cleared')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_order
  ON risk_signals(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(30),
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(60) NOT NULL,
  resource_id VARCHAR(120),
  ip_address VARCHAR(64),
  request_id VARCHAR(120),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entries_resource
  ON audit_log_entries(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entries_actor
  ON audit_log_entries(actor_user_id, created_at DESC);
