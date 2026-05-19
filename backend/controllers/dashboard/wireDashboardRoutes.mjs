import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dashboardImports from './dashboardImports.js';
import * as dashboardHelpers from './shared/dashboardHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prefix = 'Dashboard';
const importable = { ...dashboardImports, ...dashboardHelpers };
const ctxOnly = new Set(['router', 'authenticateToken', 'supabase']);
const reserved = new Set(['router', 'authenticateToken', 'supabase', 'req', 'res', 'export', 'function', 'const', 'return', 'async', 'await', 'try', 'catch', 'if', 'else', 'for', 'of', 'in', 'new', 'typeof', 'default', 'error', 'data', 'status', 'message', 'console', 'ctx']);

for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('Routes.js') && f !== 'orderDeletionRoutes.js')) {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const base = file.replace(/Routes\.js$/, '');
  const registerName = `register${prefix}${base.charAt(0).toUpperCase() + base.slice(1)}Routes`;

  content = content.replace(/export function register\w+Routes\(ctx\)/, `export function ${registerName}(ctx)`);
  const match = content.match(new RegExp(`export function ${registerName}\\(ctx\\) \\{\\s*const \\{[\\s\\S]*?\\} = ctx;\\s*`));
  if (!match) {
    console.warn('skip', file);
    continue;
  }
  const body = content.slice(match.index + match[0].length);
  const usedFromImports = Object.keys(importable)
    .filter((n) => !ctxOnly.has(n))
    .filter((n) => new RegExp(`\\b${n}\\b`).test(body) && !reserved.has(n));
  const usedCtx = [...ctxOnly].filter((n) => new RegExp(`\\b${n}\\b`).test(body));

  const header = `/** Dashboard routes: ${base} */\nimport {\n  ${usedFromImports.sort().join(',\n  ')}\n} from './dashboardImports.js';\nexport * from './shared/dashboardHelpers.js';\n\nexport function ${registerName}(ctx) {\n  const {\n    ${usedCtx.join(',\n    ')}\n  } = ctx;\n\n`;

  fs.writeFileSync(filePath, header + body.replace(/\nexport \{ router as dashboardRouter \};?\s*$/, '\n'));
  console.log('wired', file);
}
