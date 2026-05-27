-- ============================================
-- TATVA DIRECT - COMPLETE DATABASE SCHEMA
-- ============================================
-- Copy and paste this ENTIRE file into Supabase SQL Editor
-- Then click "Run" to create all tables
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for text search (if needed)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  user_type VARCHAR(20) DEFAULT '' CHECK (user_type IN ('service_provider', 'supplier', 'admin', '')),
  company VARCHAR(100),
  phone VARCHAR(20),
  address JSONB DEFAULT '{}', -- {street, city, state, zipCode, country}
  profile JSONB DEFAULT '{}', -- {gstin, panNumber, projects[], branches[], businessType, categories[], website, description, establishedYear}
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  password_changed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_profile_categories ON users USING GIN ((profile->'categories'));

-- ============================================
-- CATEGORIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100),
  default_specifications JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_is_active ON categories(is_active);

-- ============================================
-- UNITS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(20) UNIQUE NOT NULL,
  display_name VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_name ON units(name);
CREATE INDEX IF NOT EXISTS idx_units_is_active ON units(is_active);

-- ============================================
-- PRODUCTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  unit VARCHAR(20) NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  min_order_quantity INTEGER DEFAULT 1 CHECK (min_order_quantity >= 1),
  location VARCHAR(200) NOT NULL,
  supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
  specifications JSONB DEFAULT '{}',
  images TEXT[], -- Array of image URLs (Supabase Storage paths)
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  tags TEXT[],
  average_rating DECIMAL(3,2) DEFAULT 0 CHECK (average_rating >= 0 AND average_rating <= 5),
  total_reviews INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_name_desc ON products USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- ============================================
-- BOQS TABLE (Bill of Quantities)
-- ============================================
CREATE TABLE IF NOT EXISTS boqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  service_provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project JSONB DEFAULT '{}', -- {name, location, type, estimatedValue}
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'normalized', 'vendor_selection', 'completed', 'cancelled')),
  total_value DECIMAL(10,2) DEFAULT 0 CHECK (total_value >= 0),
  normalized_at TIMESTAMP,
  completed_at TIMESTAMP,
  uploaded_file JSONB, -- {filename, originalName, path, size, mimetype}
  processing_log JSONB[] DEFAULT '{}', -- Array of {action, timestamp, details, user}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boqs_service_provider ON boqs(service_provider_id);
CREATE INDEX IF NOT EXISTS idx_boqs_status ON boqs(status);
CREATE INDEX IF NOT EXISTS idx_boqs_created_at ON boqs(created_at DESC);

-- ============================================
-- BOQ ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS boq_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  boq_id UUID REFERENCES boqs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL CHECK (quantity >= 0),
  unit VARCHAR(20) NOT NULL,
  rate DECIMAL(10,2) CHECK (rate >= 0),
  amount DECIMAL(10,2) CHECK (amount >= 0),
  category VARCHAR(50),
  specifications TEXT,
  normalized_product_id UUID REFERENCES products(id),
  alternatives JSONB[] DEFAULT '{}', -- Array of {product, matchScore, priceVariance}
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boq_items_boq ON boq_items(boq_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_category ON boq_items(category);
CREATE INDEX IF NOT EXISTS idx_boq_items_normalized_product ON boq_items(normalized_product_id);

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  service_provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
  boq_id UUID REFERENCES boqs(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned')),
  total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
  payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'refunded')),
  payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card')),
  delivery_address JSONB, -- {street, city, state, zipCode, country, contactPerson, contactPhone}
  expected_delivery_date TIMESTAMP,
  actual_delivery_date TIMESTAMP,
  notes TEXT,
  internal_notes TEXT,
  attachments JSONB[] DEFAULT '{}', -- Array of {filename, originalName, path, uploadedAt}
  status_history JSONB[] DEFAULT '{}', -- Array of {status, timestamp, updatedBy, notes}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- SUPPLIER RATINGS TABLE (SERVICE PROVIDER → SUPPLIER)
-- ============================================
CREATE TABLE IF NOT EXISTS supplier_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES users(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ratings_supplier ON supplier_ratings(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ratings_sp ON supplier_ratings(service_provider_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ratings_order ON supplier_ratings(order_id);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_service_provider ON orders(service_provider_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_boq ON orders(boq_id);

-- ============================================
-- ORDER ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),
  specifications TEXT,
  delivery_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('payment_received', 'payment_receipt', 'order_status', 'product_approval', 'system', 'supplier_edit', 'product_update')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  related_order_id UUID REFERENCES orders(id),
  related_product_id UUID REFERENCES products(id),
  related_supplier_id UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- ============================================
-- PAYMENT RECEIPTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS payment_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_number VARCHAR(60) UNIQUE NOT NULL,
  order_id UUID UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  service_provider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'bank_transfer', 'online', 'credit', 'upi', 'card')),
  payment_reference VARCHAR(120),
  paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_order ON payment_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_supplier ON payment_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_service_provider ON payment_receipts(service_provider_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to all tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_boqs_updated_at ON boqs;
CREATE TRIGGER update_boqs_updated_at BEFORE UPDATE ON boqs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_units_updated_at ON units;
CREATE TRIGGER update_units_updated_at BEFORE UPDATE ON units
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate order number
CREATE TABLE IF NOT EXISTS order_number_counters (
    order_date DATE PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
    candidate VARCHAR(50);
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        LOOP
            candidate := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
              UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || COALESCE(NEW.id::TEXT, '')), 1, 10));
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM orders WHERE order_number = candidate
            );
        END LOOP;
        NEW.order_number := candidate;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION generate_order_number();

-- ============================================
-- ROW LEVEL SECURITY (RLS) - Optional
-- ============================================
-- Enable RLS if you want to use Supabase's built-in security
-- Uncomment these lines if you want to enable Row Level Security:
-- 
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE boqs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE units ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;
--
-- Note: You'll need to create policies based on your authentication requirements
-- For now, we'll handle security at the application level using JWT tokens

-- ============================================
-- VERIFICATION QUERIES (Run these after schema creation)
-- ============================================
-- Uncomment and run these to verify tables were created:

-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- ORDER BY table_name;

-- SELECT COUNT(*) as table_count FROM information_schema.tables 
-- WHERE table_schema = 'public';

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
-- If you see this message, all tables have been created successfully!
-- You should now see 9 tables in your Supabase Table Editor:
-- 1. users
-- 2. categories
-- 3. units
-- 4. products
-- 5. boqs
-- 6. boq_items
-- 7. orders
-- 8. order_items
-- 9. notifications
--
-- All indexes, triggers, and functions have also been created!