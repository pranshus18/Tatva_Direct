/**
 * Verifies modular controllers: imports + route counts.
 * Run: node scripts/verifyModularControllers.mjs
 */
import express from 'express';
import { supplierRouter } from '../controllers/supplierController.js';
import { poRouter } from '../controllers/poController.js';
import { adminRouter } from '../controllers/adminController.js';
import { dashboardRouter } from '../controllers/dashboardController.js';
import { boqRouter } from '../controllers/boqController.js';

function countRoutes(stack) {
  const out = [];
  for (const layer of stack || []) {
    if (layer.route?.path) {
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) {
          out.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...countRoutes(layer.handle.stack));
    }
  }
  return out;
}

const expected = {
  supplier: 48,
  po: 12,
  boq: 4,
  dashboard: 11
};

const routers = {
  supplier: supplierRouter,
  po: poRouter,
  admin: adminRouter,
  dashboard: dashboardRouter,
  boq: boqRouter
};

let failed = false;

for (const [name, router] of Object.entries(routers)) {
  const routes = countRoutes(router.stack);
  const exp = expected[name];
  const ok = exp ? routes.length === exp : routes.length > 0;
  console.log(`${name}: ${routes.length} routes${exp ? ` (expected ${exp})` : ''} ${ok || !exp ? '✔' : '✘'}`);
  if (exp && routes.length !== exp) failed = true;
}

if (failed) process.exit(1);
console.log('\n✔ All modular controllers loaded with expected route counts.');
process.exit(0);
