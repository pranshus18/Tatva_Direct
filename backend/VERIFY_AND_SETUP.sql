-- ============================================
-- TATVA DIRECT - VERIFICATION & SETUP SQL
-- ============================================
-- Run this in Supabase SQL Editor to verify and set up everything
-- ============================================

-- ============================================
-- 1. VERIFY/CREATE EXTENSIONS
-- ============================================

-- Check existing extensions
SELECT extname, extversion 
FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'pg_trgm');

-- Create UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create pg_trgm extension for text search (if not exists)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Verify extensions are installed
SELECT 'Extensions installed:' as status;
SELECT extname, extversion 
FROM pg_extension 
WHERE extname IN ('uuid-ossp', 'pg_trgm');

-- ============================================
-- 2. VERIFY TABLES EXIST
-- ============================================

SELECT 'Tables verification:' as status;
SELECT 
    table_name,
    CASE 
        WHEN table_name IN ('users', 'categories', 'units', 'products', 'boqs', 'boq_items', 'orders', 'order_items', 'notifications')
        THEN '✅ Required'
        ELSE '⚠️ Extra'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Count tables
SELECT COUNT(*) as total_tables
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';

-- ============================================
-- 3. VERIFY/CREATE FUNCTIONS
-- ============================================

-- Check if update_updated_at_column function exists
SELECT 'Functions verification:' as status;
SELECT 
    routine_name,
    routine_type,
    CASE 
        WHEN routine_name IN ('update_updated_at_column', 'generate_order_number')
        THEN '✅ Required'
        ELSE '⚠️ Extra'
    END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Create update_updated_at_column function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create generate_order_number function if not exists
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
-- 4. VERIFY/CREATE TRIGGERS
-- ============================================

-- Check existing triggers
SELECT 'Triggers verification:' as status;
SELECT 
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation,
    CASE 
        WHEN trigger_name IN (
            'update_users_updated_at',
            'update_products_updated_at',
            'update_orders_updated_at',
            'update_boqs_updated_at',
            'update_categories_updated_at',
            'update_units_updated_at',
            'generate_order_number_trigger'
        )
        THEN '✅ Required'
        ELSE '⚠️ Extra'
    END as status
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- Create triggers if they don't exist
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

DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;
CREATE TRIGGER generate_order_number_trigger 
    BEFORE INSERT ON orders
    FOR EACH ROW 
    EXECUTE FUNCTION generate_order_number();

-- ============================================
-- 5. VERIFY FOREIGN KEY RELATIONSHIPS
-- ============================================

SELECT 'Foreign Keys verification:' as status;
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    CASE 
        WHEN tc.constraint_name LIKE '%_fkey' THEN '✅ Valid FK'
        ELSE '⚠️ Check'
    END as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- ============================================
-- 6. VERIFY INDEXES
-- ============================================

SELECT 'Indexes verification:' as status;
SELECT
    tablename,
    indexname,
    indexdef,
    CASE 
        WHEN indexname LIKE 'idx_%' THEN '✅ Custom Index'
        WHEN indexname LIKE '%_pkey' THEN '✅ Primary Key'
        WHEN indexname LIKE '%_fkey' THEN '✅ Foreign Key Index'
        ELSE '⚠️ Auto-generated'
    END as index_type
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Count indexes per table
SELECT 
    tablename,
    COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- ============================================
-- 7. VERIFY TABLE STRUCTURES
-- ============================================

-- Check column counts for each table
SELECT 'Table structures verification:' as status;
SELECT 
    table_name,
    COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name IN ('users', 'categories', 'units', 'products', 'boqs', 'boq_items', 'orders', 'order_items', 'notifications')
GROUP BY table_name
ORDER BY table_name;

-- ============================================
-- 8. CHECK FOR MISSING CONSTRAINTS
-- ============================================

SELECT 'Constraints verification:' as status;
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    CASE 
        WHEN tc.constraint_type = 'PRIMARY KEY' THEN '✅ PK'
        WHEN tc.constraint_type = 'FOREIGN KEY' THEN '✅ FK'
        WHEN tc.constraint_type = 'UNIQUE' THEN '✅ UNIQUE'
        WHEN tc.constraint_type = 'CHECK' THEN '✅ CHECK'
        ELSE '⚠️ Other'
    END as status
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
    AND tc.table_name IN ('users', 'categories', 'units', 'products', 'boqs', 'boq_items', 'orders', 'order_items', 'notifications')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- ============================================
-- 9. SUMMARY REPORT
-- ============================================

SELECT '=== SETUP SUMMARY ===' as summary;

-- Tables count
SELECT 
    'Tables' as component,
    COUNT(*)::text as count,
    CASE 
        WHEN COUNT(*) >= 9 THEN '✅ Complete'
        ELSE '❌ Missing tables'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
AND table_name IN ('users', 'categories', 'units', 'products', 'boqs', 'boq_items', 'orders', 'order_items', 'notifications');

-- Functions count
SELECT 
    'Functions' as component,
    COUNT(*)::text as count,
    CASE 
        WHEN COUNT(*) >= 2 THEN '✅ Complete'
        ELSE '❌ Missing functions'
    END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_type = 'FUNCTION'
AND routine_name IN ('update_updated_at_column', 'generate_order_number');

-- Triggers count
SELECT 
    'Triggers' as component,
    COUNT(*)::text as count,
    CASE 
        WHEN COUNT(*) >= 7 THEN '✅ Complete'
        ELSE '❌ Missing triggers'
    END as status
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name IN (
    'update_users_updated_at',
    'update_products_updated_at',
    'update_orders_updated_at',
    'update_boqs_updated_at',
    'update_categories_updated_at',
    'update_units_updated_at',
    'generate_order_number_trigger'
);

-- Foreign Keys count
SELECT 
    'Foreign Keys' as component,
    COUNT(*)::text as count,
    CASE 
        WHEN COUNT(*) >= 10 THEN '✅ Complete'
        ELSE '⚠️ Check relationships'
    END as status
FROM information_schema.table_constraints
WHERE constraint_type = 'FOREIGN KEY'
AND table_schema = 'public';

-- Extensions count
SELECT 
    'Extensions' as component,
    COUNT(*)::text as count,
    CASE 
        WHEN COUNT(*) >= 2 THEN '✅ Complete'
        ELSE '❌ Missing extensions'
    END as status
FROM pg_extension
WHERE extname IN ('uuid-ossp', 'pg_trgm');

-- ============================================
-- 10. TEST DATA VERIFICATION (Optional)
-- ============================================

-- Check if tables are empty (expected if no data migration yet)
SELECT 'Data verification:' as status;
SELECT 
    'users' as table_name,
    COUNT(*) as row_count
FROM users
UNION ALL
SELECT 
    'products' as table_name,
    COUNT(*) as row_count
FROM products
UNION ALL
SELECT 
    'orders' as table_name,
    COUNT(*) as row_count
FROM orders
UNION ALL
SELECT 
    'boqs' as table_name,
    COUNT(*) as row_count
FROM boqs
UNION ALL
SELECT 
    'categories' as table_name,
    COUNT(*) as row_count
FROM categories
UNION ALL
SELECT 
    'units' as table_name,
    COUNT(*) as row_count
FROM units
UNION ALL
SELECT 
    'notifications' as table_name,
    COUNT(*) as row_count
FROM notifications
ORDER BY table_name;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT '✅ Verification complete! Check the results above.' as message;
SELECT '⚠️ Note: Storage buckets must be created manually in Supabase Dashboard → Storage' as note;
