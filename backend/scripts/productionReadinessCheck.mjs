#!/usr/bin/env node
/**
 * Production readiness check for modular controllers.
 * Run from backend/: node scripts/productionReadinessCheck.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: backendRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

const steps = [
  ['node', ['--test', 'tests/errorHandler.test.js', 'tests/orderLifecycle.test.js', 'tests/voiceCheckoutTransport.test.js']],
  ['node', ['scripts/verifyModularControllers.mjs']],
  ['node', ['scripts/verifySupplierRoutes.mjs']],
  ['node', ['voice/scripts/voice-steps-unit-test.mjs']]
];

console.log('Production readiness check\n');
let failed = false;

for (const [cmd, args] of steps) {
  const label = [cmd, ...args].join(' ');
  process.stdout.write(`• ${label} ... `);
  const { code, out, err } = await run(cmd, args);
  if (code === 0) {
    console.log('OK');
  } else {
    console.log('FAILED');
    console.log(err || out);
    failed = true;
  }
}

// Import chain (does not start server)
try {
  await import('../controllers/poController.js');
  await import('../controllers/supplierController.js');
  await import('../controllers/dashboardController.js');
  await import('../controllers/boqController.js');
  await import('../controllers/adminController.js');
  await import('../routes/api.js');
  console.log('• Module import chain ... OK');
} catch (e) {
  console.log('• Module import chain ... FAILED');
  console.error(e.message);
  failed = true;
}

if (failed) {
  console.error('\n✘ Production readiness check FAILED');
  process.exit(1);
}
console.log('\n✔ Production readiness check passed (run apiSmokeTest with server up for HTTP checks).');
process.exit(0);
