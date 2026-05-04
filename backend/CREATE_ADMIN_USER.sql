-- ============================================
-- CREATE/UPDATE ADMIN USER MANUALLY
-- ============================================
-- Run this in Supabase SQL Editor if admin login is not working
-- Replace the email and password hash with your values
-- ============================================

-- Option 1: Create admin user if it doesn't exist
-- Replace 'pranshu@gmail.com' with your ADMIN_EMAIL
-- Replace the password hash with a bcrypt hash of 'pranshu@123'

-- First, check if admin user exists
SELECT * FROM users WHERE email = 'pranshu@gmail.com';

-- If user doesn't exist, create it
-- Note: You need to generate a bcrypt hash for the password
-- Use this Node.js code to generate hash:
-- const bcrypt = require('bcryptjs');
-- const hash = await bcrypt.hash('pranshu@123', 12);
-- console.log(hash);

-- Then insert (replace HASHED_PASSWORD with the generated hash):
/*
INSERT INTO users (
  name,
  email,
  password,
  user_type,
  company,
  is_active,
  email_verified
)
VALUES (
  'Admin User',
  'pranshu@gmail.com',
  'HASHED_PASSWORD_HERE',  -- Replace with bcrypt hash
  'admin',
  'Tatva Direct',
  true,
  true
)
ON CONFLICT (email) DO NOTHING;
*/

-- Option 2: Update existing user to admin
-- If user exists but user_type is not 'admin', update it:
UPDATE users
SET 
  user_type = 'admin',
  is_active = true,
  email_verified = true
WHERE email = 'pranshu@gmail.com';

-- Option 3: Reset admin password (if you know the current password hash)
-- This requires you to generate a new bcrypt hash first
/*
UPDATE users
SET password = 'NEW_HASHED_PASSWORD_HERE'  -- Replace with new bcrypt hash
WHERE email = 'pranshu@gmail.com' AND user_type = 'admin';
*/

-- Verify admin user
SELECT 
  id,
  name,
  email,
  user_type,
  is_active,
  email_verified,
  created_at
FROM users
WHERE email = 'pranshu@gmail.com';

-- ============================================
-- EASIER METHOD: Use the backend API
-- ============================================
-- Instead of SQL, you can use the backend to create admin:
-- 1. Make sure ADMIN_EMAIL and ADMIN_PASSWORD are in .env
-- 2. Restart backend server
-- 3. Try logging in with admin credentials
-- 4. Backend will auto-create admin user on first login
