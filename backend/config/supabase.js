import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
const envPath = join(__dirname, '.env');
dotenv.config({ path: envPath });

// Also try env.local in backend directory
const envLocalPath = join(__dirname, 'env.local');
dotenv.config({ path: envLocalPath });

// Also try root directory as fallback
const rootEnvPath = join(__dirname, '..', '.env');
dotenv.config({ path: rootEnvPath });

// Also try root env.local
const rootEnvLocalPath = join(__dirname, '..', 'env.local');
dotenv.config({ path: rootEnvLocalPath });

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role key for backend operations
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing!');
  console.error('Required environment variables:');
  console.error('  - SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
  throw new Error('Supabase configuration is required');
}

// Create Supabase client with service role key (for backend operations)
// This bypasses RLS and should only be used server-side
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Test connection
const testConnection = async () => {
  try {
    console.log('🔄 Testing Supabase connection...');
    const { data, error } = await supabase.from('users').select('count').limit(1);
    
    if (error) {
      // If users table doesn't exist, that's okay - we'll create it
      if (error.code === '42P01') {
        console.log('⚠️  Users table not found. Please run the schema.sql file in Supabase SQL Editor.');
        return { connected: false, error: 'Schema not initialized' };
      }
      throw error;
    }
    
    console.log('✅ Supabase connected successfully');
    console.log(`📍 Supabase URL: ${supabaseUrl}`);
    return { connected: true };
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    throw error;
  }
};

// Export Supabase client and connection test
export { supabase, testConnection };
export default supabase;
