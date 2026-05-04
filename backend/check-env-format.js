import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envFiles = [
  join(__dirname, '.env'),
  join(__dirname, 'env.local'),
  join(__dirname, '..', '.env'),
  join(__dirname, '..', 'env.local')
];

console.log('🔍 Checking environment files...\n');

envFiles.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    console.log(`✅ Found: ${filePath}`);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
      
      console.log(`   Size: ${content.length} bytes`);
      console.log(`   Non-comment lines: ${lines.length}`);
      
      // Check for common issues
      const issues = [];
      lines.forEach((line, index) => {
        if (line.includes(' = ')) {
          issues.push(`Line ${index + 1}: Has spaces around = sign`);
        }
        if (line.startsWith('"') || line.startsWith("'")) {
          issues.push(`Line ${index + 1}: Starts with quotes`);
        }
        if (!line.includes('=')) {
          issues.push(`Line ${index + 1}: Missing = sign`);
        }
      });
      
      if (issues.length > 0) {
        console.log(`   ⚠️  Issues found:`);
        issues.slice(0, 5).forEach(issue => console.log(`      - ${issue}`));
      } else {
        console.log(`   ✅ Format looks good`);
      }
      
      // Check for required variables
      const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
      const found = required.filter(key => content.includes(key));
      console.log(`   Required vars found: ${found.length}/${required.length}`);
      if (found.length < required.length) {
        const missing = required.filter(key => !content.includes(key));
        console.log(`   Missing: ${missing.join(', ')}`);
      }
      
      console.log('');
    } catch (error) {
      console.log(`   ❌ Error reading file: ${error.message}\n`);
    }
  } else {
    console.log(`❌ Not found: ${filePath}`);
  }
});

console.log('\n💡 Tips:');
console.log('1. Make sure .env file is in backend/ directory');
console.log('2. Format: KEY=value (no spaces around =)');
console.log('3. No quotes unless value has spaces');
console.log('4. One variable per line');
