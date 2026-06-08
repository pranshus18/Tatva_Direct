import test from 'node:test';
import assert from 'node:assert/strict';
import { profileRouter } from '../controllers/profileController.js';

function collectRoutes(stack, prefix = '') {
  const out = [];
  for (const layer of stack || []) {
    if (layer.route?.path) {
      const routePath = `${prefix}${layer.route.path}`;
      for (const method of Object.keys(layer.route.methods || {})) {
        if (layer.route.methods[method]) {
          out.push(`${method.toUpperCase()} ${routePath}`);
        }
      }
      continue;
    }
    if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...collectRoutes(layer.handle.stack, prefix));
    }
  }
  return out;
}

test('profileRouter exposes all expected profile endpoints', () => {
  const routes = collectRoutes(profileRouter.stack).sort();
  const expected = [
    'DELETE /photo',
    'GET /',
    'GET /service-provider/theme',
    'GET /supplier/chain-role-options',
    'GET /supplier/theme',
    'POST /photo',
    'DELETE /supplier/authorization-certificate',
    'POST /supplier/authorization-certificate',
    'PUT /',
    'PUT /service-provider/theme',
    'PUT /supplier/theme'
  ].sort();

  assert.deepEqual(routes, expected);
});
