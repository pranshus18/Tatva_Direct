-- ============================================
-- MIGRATION: Add ledger_entries table
-- ============================================
-- Purpose:
-- - Minimal financial ledger to track accounting movements
-- - Not a full ERP, but enough for audit and reporting
--
-- This is additive and non-breaking.
-- ============================================

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_date TIMESTAMP NOT NULL DEFAULT NOW(),
  debit_account VARCHAR(100) NOT NULL,
  credit_account VARCHAR(100) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  reference_type VARCHAR(30), -- e.g. 'order', 'invoice', 'payment_receipt'
  reference_id UUID,
  description TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_ref ON ledger_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(entry_date);

