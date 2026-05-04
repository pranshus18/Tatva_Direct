-- ============================================
-- Migration: Add Payment Receipts
-- ============================================
-- Purpose:
-- - Create an auditable payment receipt record when an order is paid
-- - Allow both service provider and supplier to access the receipt
-- - Extend notifications types to include 'payment_receipt'
--
-- Run this in Supabase SQL Editor AFTER base schema is applied.

-- 1) Extend notifications type check constraint to include 'payment_receipt'
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'payment_received',
    'payment_receipt',
    'order_status',
    'product_approval',
    'system',
    'supplier_edit',
    'product_update'
  ));

-- 2) Create payment_receipts table
CREATE TABLE IF NOT EXISTS payment_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_number VARCHAR(60) UNIQUE NOT NULL,
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'online', 'credit')),
  payment_reference VARCHAR(120),
  paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_order ON payment_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_supplier ON payment_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_service_provider ON payment_receipts(service_provider_id);

