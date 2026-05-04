-- ============================================
-- MIGRATION: Remove legacy company info fields from service_provider profile JSON
-- ============================================
-- Purpose:
-- - Service provider profile no longer keeps these keys in users.profile JSON:
--   - gstin
--   - panNumber
-- ============================================

UPDATE users
SET profile = COALESCE(profile, '{}'::jsonb) - 'gstin' - 'panNumber'
WHERE user_type = 'service_provider';

