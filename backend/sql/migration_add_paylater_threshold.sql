-- ============================================
-- MIGRATION: Pay-later minimum order amount (per buyer/customer)
-- ============================================
-- Requires supplier_credit_accounts (migration_add_supplier_credit_accounts.sql).
-- 0 = no minimum (any order amount qualifies, subject to credit limit).
-- Safe to run multiple times.

ALTER TABLE supplier_credit_accounts
  ADD COLUMN IF NOT EXISTS paylater_threshold DECIMAL(14, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_credit_accounts_paylater_threshold_check'
  ) THEN
    ALTER TABLE supplier_credit_accounts
      ADD CONSTRAINT supplier_credit_accounts_paylater_threshold_check
      CHECK (paylater_threshold >= 0);
  END IF;
END $$;
