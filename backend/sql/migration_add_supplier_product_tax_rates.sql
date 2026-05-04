-- ============================================
-- MIGRATION: Add GST rate fields to supplier_products
-- ============================================
-- Purpose:
-- - Store supplier-selected tax rates for each inventory offer.
-- - Enforce allowed dropdown values:
--   IGST: 0, 5, 12, 18, 28
--   CGST/SGST: 0, 2.5, 6, 9, 14
-- - Enforce consistency: IGST = CGST + SGST and CGST = SGST.
-- ============================================

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5,2);

ALTER TABLE supplier_products
  DROP CONSTRAINT IF EXISTS supplier_products_tax_rates_chk;

ALTER TABLE supplier_products
  ADD CONSTRAINT supplier_products_tax_rates_chk
  CHECK (
    (
      igst_rate IS NULL
      AND cgst_rate IS NULL
      AND sgst_rate IS NULL
    )
    OR (
      igst_rate IN (0, 5, 12, 18, 28)
      AND cgst_rate IN (0, 2.5, 6, 9, 14)
      AND sgst_rate IN (0, 2.5, 6, 9, 14)
      AND cgst_rate = sgst_rate
      AND igst_rate = (cgst_rate + sgst_rate)
    )
  )
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_supplier_products_igst_rate
  ON supplier_products(igst_rate);

