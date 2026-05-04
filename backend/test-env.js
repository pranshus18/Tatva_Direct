import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load from backend directory first
const envPath = join(__dirname, '.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

// Also try env.local in backend directory
const envLocalPath = join(__dirname, 'env.local');
console.log('Also checking env.local:', envLocalPath);
dotenv.config({ path: envLocalPath });

// Also try root directory as fallback
const rootEnvPath = join(__dirname, '..', '.env');
console.log('Also checking root .env:', rootEnvPath);
dotenv.config({ path: rootEnvPath });

// Also try root env.local
const rootEnvLocalPath = join(__dirname, '..', 'env.local');
console.log('Also checking root env.local:', rootEnvLocalPath);
dotenv.config({ path: rootEnvLocalPath });

console.log('\n=== Environment Variables Check ===');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? `✅ Found (${process.env.GEMINI_API_KEY.length} characters)` : '❌ NOT FOUND');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `✅ Found (${process.env.OPENAI_API_KEY.length} characters)` : '❌ NOT FOUND');
console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `✅ Found (${process.env.ANTHROPIC_API_KEY.length} characters)` : '❌ NOT FOUND');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Found' : '❌ NOT FOUND');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ Found' : '❌ NOT FOUND');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Found' : '❌ NOT FOUND');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅ Found' : '❌ NOT FOUND');

// Check required variables
const requiredVars = {
  'SUPABASE_URL': process.env.SUPABASE_URL,
  'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'JWT_SECRET': process.env.JWT_SECRET
};

const missingRequired = Object.entries(requiredVars)
  .filter(([key, value]) => !value)
  .map(([key]) => key);

if (missingRequired.length > 0) {
  console.log('\n❌ ERROR: Missing required environment variables:');
  missingRequired.forEach(key => console.log(`  - ${key}`));
  console.log('\nPlease check:');
  console.log('1. The .env or env.local file exists in the backend/ directory');
  console.log('2. All required variables are set');
  console.log('3. There are no spaces around the = sign');
  console.log('4. Values are not wrapped in quotes (unless they contain spaces)');
  process.exit(1);
} else {
  console.log('\n✅ All required environment variables are configured!');
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️  Note: No AI API keys found (optional, but recommended for AI features)');
  }
  process.exit(0);
}
