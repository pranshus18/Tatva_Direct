-- ============================================
-- QUICK SQL QUERIES TO CHECK USER DATA
-- ============================================
-- Run these in Supabase SQL Editor to verify your signup
-- ============================================

-- 1. View ALL users (most recent first)
SELECT 
  id,
  name,
  email,
  user_type,
  company,
  phone,
  is_active,
  email_verified,
  created_at
FROM users
ORDER BY created_at DESC;

-- 2. View ONLY suppliers
SELECT 
  id,
  name,
  email,
  company,
  phone,
  is_active,
  created_at
FROM users
WHERE user_type = 'supplier'
ORDER BY created_at DESC;

-- 3. Count users by type
SELECT 
  user_type,
  COUNT(*) as count
FROM users
GROUP BY user_type
ORDER BY count DESC;

-- 4. View recent signups (last 24 hours)
SELECT 
  name,
  email,
  user_type,
  company,
  created_at
FROM users
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 5. Search for specific email (replace with your email)
SELECT 
  id,
  name,
  email,
  user_type,
  company,
  phone,
  is_active,
  email_verified,
  created_at
FROM users
WHERE LOWER(email) = LOWER('your-email@example.com');

-- 6. View all columns for a specific user (replace email)
SELECT *
FROM users
WHERE LOWER(email) = LOWER('your-email@example.com');

-- 7. Check if table exists and has data
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN user_type = 'supplier' THEN 1 END) as suppliers,
  COUNT(CASE WHEN user_type = 'service_provider' THEN 1 END) as service_providers,
  COUNT(CASE WHEN user_type = 'admin' THEN 1 END) as admins,
  MAX(created_at) as latest_signup
FROM users;

-- 8. View users with missing data
SELECT 
  id,
  name,
  email,
  user_type,
  CASE 
    WHEN company IS NULL OR company = '' THEN '❌ No company'
    ELSE '✅ Has company'
  END as company_status,
  CASE 
    WHEN phone IS NULL OR phone = '' THEN '❌ No phone'
    ELSE '✅ Has phone'
  END as phone_status,
  created_at
FROM users
ORDER BY created_at DESC;
