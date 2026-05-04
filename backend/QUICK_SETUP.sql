-- ============================================
-- TATVA DIRECT - QUICK SETUP SQL
-- ============================================
-- Run this AFTER running COMPLETE_SCHEMA.sql
-- This ensures all functions, triggers, and extensions are set up
-- ============================================

-- ============================================
-- 1. CREATE EXTENSIONS
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- 2. CREATE FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

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

-- ============================================
-- 3. CREATE TRIGGERS
-- ============================================

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at 
    BEFORE UPDATE ON products
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_boqs_updated_at ON boqs;
CREATE TRIGGER update_boqs_updated_at 
    BEFORE UPDATE ON boqs
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at 
    BEFORE UPDATE ON categories
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_units_updated_at ON units;
CREATE TRIGGER update_units_updated_at 
    BEFORE UPDATE ON units
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Order number generation trigger
DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger 
    BEFORE INSERT ON orders
    FOR EACH ROW 
    EXECUTE FUNCTION generate_order_number();

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT '✅ Quick setup complete! All functions and triggers are now active.' as status;
