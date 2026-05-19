import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as poImports from './poImports.js';
import * as poHelpers from './shared/poHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prefix = 'Po';
const importable = { ...poImports, ...poHelpers };
const ctxOnly = new Set(['router', 'authenticateToken', 'isServiceProvider', 'supabase']);

const reserved = new Set([
  'router', 'authenticateToken', 'isServiceProvider', 'supabase', 'req', 'res', 'next', 'error',
  'data', 'status', 'message', 'true', 'false', 'null', 'undefined', 'JSON', 'Number', 'String',
  'Array', 'Object', 'Date', 'Math', 'console', 'parseInt', 'parseFloat', 'isNaN', 'Set', 'Map',
  'Promise', 'Error', 'ctx', 'export', 'function', 'const', 'let', 'var', 'return', 'async',
  'await', 'try', 'catch', 'if', 'else', 'for', 'of', 'in', 'new', 'typeof', 'default'
]);

for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('Routes.js'))) {
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
  const bodyStart = match.index + match[0].length;
  const body = content.slice(bodyStart);

  const usedFromImports = Object.keys(importable)
    .filter((name) => !ctxOnly.has(name))
    .filter((name) => new RegExp(`\\b${name}\\b`).test(body));

  const usedCtx = [...ctxOnly].filter((name) => new RegExp(`\\b${name}\\b`).test(body));

  const importLines = usedFromImports.length
    ? `import {\n  ${usedFromImports.sort().join(',\n  ')}\n} from './poImports.js';\n`
    : '';

  const helperUsed = Object.keys(poHelpers).filter((name) => new RegExp(`\\b${name}\\b`).test(body));
  const helperImport =
    helperUsed.length && helperUsed.some((n) => !usedFromImports.includes(n))
      ? `import {\n  ${[...new Set(helperUsed)].sort().join(',\n  ')}\n} from './shared/poHelpers.js';\n`
      : '';

  const header = `/** PO routes: ${base} */\n${importLines}${helperImport}\nexport function ${registerName}(ctx) {\n  const {\n    ${usedCtx.join(',\n    ')}\n  } = ctx;\n\n`;

  fs.writeFileSync(filePath, header + body);
  console.log('wired', file, usedFromImports.length, 'imports');
}
