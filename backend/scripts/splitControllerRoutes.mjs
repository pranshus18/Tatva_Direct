/**
 * Extract route blocks from a monolithic controller into register modules.
 * Usage: node scripts/splitControllerRoutes.mjs <controllerPath> <outDir> <sections.json>
 *
 * sections.json example:
 * [{"name":"groupRoutes","start":255,"end":875}]
 */
import fs from 'fs';
import path from 'path';

const [controllerPath, outDir, sectionsPath] = process.argv.slice(2);
if (!controllerPath || !outDir || !sectionsPath) {
  console.error('Usage: node splitControllerRoutes.mjs <controller.js> <outDir> <sections.json>');
  process.exit(1);
}

const lines = fs.readFileSync(controllerPath, 'utf8').split('\n');
const sections = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));

fs.mkdirSync(outDir, { recursive: true });

function extract(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

for (const s of sections) {
  let body = extract(s.start, s.end);
  if (s.extra) {
    for (const [a, b] of s.extra) {
      body += '\n\n' + extract(a, b);
    }
  }
  const base = s.name.replace(/Routes$/, '');
  const registerName = `register${base.charAt(0).toUpperCase() + base.slice(1)}Routes`;
  const out = `/** Routes: ${s.name} */\nexport function ${registerName}(ctx) {\n  const { router, authenticateToken, isServiceProvider, supabase } = ctx;\n\n${body}\n}\n`;
  fs.writeFileSync(path.join(outDir, `${s.name}.js`), out);
  console.log('wrote', s.name, body.split('\n').length, 'lines');
}
