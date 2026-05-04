-- ============================================
-- MIGRATION: Add supplier_products junction table
-- This allows multiple suppliers to offer the same product
-- with different prices, stock, locations, etc.
-- ============================================

-- Create supplier_products junction table
CREATE TABLE IF NOT EXISTS supplier_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  min_order_quantity INTEGER DEFAULT 1 CHECK (min_order_quantity >= 1),
  location VARCHAR(200) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  -- Supplier-specific extended data (description, specs, tags, images, etc.)
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, supplier_id) -- One entry per supplier per product
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_status ON supplier_products(status);
CREATE INDEX IF NOT EXISTS idx_supplier_products_is_active ON supplier_products(is_active);

-- Migrate existing data from products to supplier_products
-- This preserves existing supplier-product relationships
INSERT INTO supplier_products (product_id, supplier_id, price, stock, min_order_quantity, location, status, is_active, approved_by, approved_at, rejection_reason, created_at, updated_at)
SELECT 
  id as product_id,
  supplier_id,
  price,
  stock,
  min_order_quantity,
  location,
  status,
  is_active,
  approved_by,
  approved_at,
  rejection_reason,
  created_at,
  updated_at
FROM products
WHERE supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;

-- Add trigger to update updated_at timestamp
-- Make this migration safe to run multiple times by dropping trigger if it exists
DROP TRIGGER IF EXISTS update_supplier_products_updated_at ON supplier_products;
CREATE TRIGGER update_supplier_products_updated_at 
  BEFORE UPDATE ON supplier_products
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Note: We keep supplier_id in products table for backward compatibility
-- but new products should use supplier_products table
-- The products table will store shared product information (name, description, category, specifications)
-- The supplier_products table will store supplier-specific data (price, stock, location, status)
