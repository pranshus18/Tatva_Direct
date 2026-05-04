-- ============================================
-- MIGRATION: Require address fields for supplier and service provider users
-- ============================================
-- Purpose:
-- - Enforce that supplier/service_provider profiles persist complete address data
--   in users.address JSONB.
-- - Required keys: line1, city, state, pincode, country.
--
-- Notes:
-- - Constraint is created as NOT VALID so existing legacy rows do not block rollout.
-- - Constraint still applies to NEW/UPDATED rows immediately.
-- - After backfilling old rows, run VALIDATE CONSTRAINT (see bottom).
-- ============================================

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_supplier_sp_address_required_chk;

ALTER TABLE users
  ADD CONSTRAINT users_supplier_sp_address_required_chk
  CHECK (
    user_type NOT IN ('supplier', 'service_provider')
    OR (
      jsonb_typeof(address) = 'object'
      AND length(trim(coalesce(address->>'line1', ''))) > 0
      AND length(trim(coalesce(address->>'city', ''))) > 0
      AND length(trim(coalesce(address->>'state', ''))) > 0
      AND length(trim(coalesce(address->>'pincode', ''))) > 0
      AND length(trim(coalesce(address->>'country', ''))) > 0
    )
  )
  NOT VALID;

-- Optional step after data backfill:
-- ALTER TABLE users VALIDATE CONSTRAINT users_supplier_sp_address_required_chk;

