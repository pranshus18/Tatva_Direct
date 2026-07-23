import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentsRouter } from '../controllers/paymentsController.js';
import { paymentsWebhookRouter } from '../controllers/payments/razorpayWebhookRouter.js';

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

test('paymentsRouter exposes all expected payment endpoints', () => {
  const routes = collectRoutes(paymentsRouter.stack).sort();
  const expected = [
    'GET /audit/logs',
    'GET /metrics',
    'GET /razorpay/config',
    'GET /risk/signals',
    'GET /settlement/report',
    'PATCH /risk/signals/:id/review',
    'POST /orders/:id/bank-transfer/mark',
    'POST /orders/:id/bank-transfer/request',
    'POST /orders/:id/credit-line/approve',
    'POST /orders/:id/razorpay/confirm',
    'POST /orders/:id/razorpay/create'
  ].sort();

  assert.deepEqual(routes, expected);
});

test('paymentsWebhookRouter exposes expected Razorpay webhook endpoint', () => {
  const routes = collectRoutes(paymentsWebhookRouter.stack).sort();
  assert.deepEqual(routes, ['POST /razorpay']);
});
