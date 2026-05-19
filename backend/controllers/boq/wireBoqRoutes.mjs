import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as boqCore from './boqCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctxOnly = new Set(['router', 'authenticateToken', 'isServiceProvider', 'supabase', 'upload']);

for (const file of ['normalizeRoutes.js', 'requestProductRoutes.js', 'boqCrudRoutes.js']) {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const base = file.replace(/Routes\.js$/, '');
  const registerName = `registerBoq${base.charAt(0).toUpperCase() + base.slice(1)}Routes`;

  content = content.replace(/export function register\w+Routes\(ctx\)/, `export function ${registerName}(ctx)`);
  const match = content.match(new RegExp(`export function ${registerName}\\(ctx\\) \\{[\\s\\S]*?\\} = ctx;\\s*`));
  if (!match) {
    console.warn('skip', file);
    continue;
  }
  const bodyStart = match.index + match[0].length;
  const body = content.slice(bodyStart).replace(/\nexport \{ router as boqRouter \};?\s*$/, '\n');

  const usedCore = Object.keys(boqCore).filter(
    (n) => !ctxOnly.has(n) && new RegExp(`\\b${n}\\b`).test(body)
  );
  const usedCtx = [...ctxOnly].filter((n) => new RegExp(`\\b${n}\\b`).test(body));

  const header = `/** BOQ routes: ${base} */\nimport {\n  ${usedCore.sort().join(',\n  ')}\n} from './boqCore.js';\nimport { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';\nimport { boqDeleteSchema, boqNormalizeBodySchema, boqRequestProductSchema } from '../../contracts/boqContracts.js';\nimport { supabase } from '../../config/supabase.js';\n\nexport function ${registerName}(ctx) {\n  const {\n    ${usedCtx.join(',\n    ')}\n  } = ctx;\n\n`;

  fs.writeFileSync(filePath, header + body + '}\n');
  console.log('wired', file, usedCore.length);
}
