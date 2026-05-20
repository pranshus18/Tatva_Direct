/**
 * Verifies supplier modular routes match expected surface area.
 * Run: node scripts/verifySupplierRoutes.mjs
 */
import express from 'express';
import { supplierRouter } from '../controllers/supplierController.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const supplierDir = path.join(__dirname, '../controllers/supplier');

const routeRegex = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;

function routesFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const routes = [];
  let m;
  while ((m = routeRegex.exec(content)) !== null) {
    routes.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return routes;
}

function routesFromRouterStack(stack) {
  const out = [];
  for (const layer of stack || []) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const method of methods) {
        out.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...routesFromRouterStack(layer.handle.stack));
    }
  }
  return out;
}

function collectJsFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const expectedFromModules = [];
for (const file of collectJsFiles(supplierDir)) {
  expectedFromModules.push(...routesFromFile(file));
}
expectedFromModules.sort();

const app = express();
app.use('/supplier', supplierRouter);
const registered = [...new Set(routesFromRouterStack(supplierRouter.stack))].sort();

const expectedSet = new Set(expectedFromModules);
const registeredSet = new Set(registered);

const missingOnRouter = expectedFromModules.filter((r) => !registeredSet.has(r));
const extraOnRouter = registered.filter((r) => !expectedSet.has(r));

console.log(`Module route definitions: ${expectedFromModules.length}`);
console.log(`Express registered routes:  ${registered.length}`);

if (missingOnRouter.length) {
  console.error('\nMISSING on router:');
  missingOnRouter.forEach((r) => console.error('  -', r));
  process.exit(1);
}

if (extraOnRouter.length) {
  console.error('\nEXTRA on router (not in modules):');
  extraOnRouter.forEach((r) => console.error('  -', r));
  process.exit(1);
}

console.log('\n✔ All 48 supplier routes match between modules and Express router.');
process.exit(0);
