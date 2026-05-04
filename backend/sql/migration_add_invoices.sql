-- ============================================
-- MIGRATION: Add invoices table
-- ============================================
-- Purpose:
-- - Store tax/commercial invoices linked to orders
-- - Separate from payment receipts (which confirm payment)
--
-- This is additive and non-breaking.
-- ============================================

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number VARCHAR(60) UNIQUE NOT NULL,
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  billing_address JSONB DEFAULT NULL,
  shipping_address JSONB DEFAULT NULL,
  subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
  issued_at TIMESTAMP,
  due_date TIMESTAMP,
  paid_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_service_provider ON invoices(service_provider_id);

