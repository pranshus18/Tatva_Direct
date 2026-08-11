import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRateSupplierForOrder,
  canSelfServeCancelOrder,
  canSelfServeEditOrder,
  getSelfServeLockReason
} from '../utils/orderSelfServeRules.js';

test('canSelfServeEditOrder allows only pending or confirmed unpaid orders', () => {
  assert.equal(canSelfServeEditOrder({ status: 'pending', paymentStatus: 'pending' }), true);
  assert.equal(canSelfServeEditOrder({ status: 'confirmed', paymentStatus: 'partial' }), true);
  assert.equal(canSelfServeEditOrder({ status: 'processing', paymentStatus: 'pending' }), false);
  assert.equal(canSelfServeEditOrder({ status: 'confirmed', paymentStatus: 'paid' }), false);
});

test('canSelfServeCancelOrder follows same lock rules as edit', () => {
  assert.equal(canSelfServeCancelOrder({ status: 'pending', paymentStatus: 'pending' }), true);
  assert.equal(canSelfServeCancelOrder({ status: 'delivered', paymentStatus: 'pending' }), false);
  assert.equal(canSelfServeCancelOrder({ status: 'pending', paymentStatus: 'paid' }), false);
});

test('canRateSupplierForOrder allows rating only after delivered and paid', () => {
  assert.equal(canRateSupplierForOrder({ status: 'delivered', paymentStatus: 'paid' }), true);
  assert.equal(canRateSupplierForOrder({ status: 'delivered', paymentStatus: 'pending' }), false);
  assert.equal(canRateSupplierForOrder({ status: 'confirmed', paymentStatus: 'paid' }), false);
});

test('getSelfServeLockReason returns user-friendly lock explanations', () => {
  assert.equal(getSelfServeLockReason({ status: 'pending', paymentStatus: 'paid' }), 'Order is already paid');
  assert.equal(getSelfServeLockReason({ status: 'processing', paymentStatus: 'pending' }), 'Order has already entered fulfillment');
  assert.equal(getSelfServeLockReason({ status: 'confirmed', paymentStatus: 'pending' }), '');
});

test('canDeleteOrder allows only delivered and paid orders', async () => {
  const { canDeleteOrder, getOrderDeleteBlockReason } = await import('../utils/orderSelfServeRules.js');
  assert.equal(canDeleteOrder({ status: 'delivered', paymentStatus: 'paid' }), true);
  assert.equal(canDeleteOrder({ status: 'delivered', paymentStatus: 'pending' }), false);
  assert.equal(canDeleteOrder({ status: 'confirmed', paymentStatus: 'paid' }), false);
  assert.equal(canDeleteOrder({ status: 'confirmed', paymentStatus: 'pending' }), false);
  assert.equal(canDeleteOrder({ status: 'confirmed', paymentStatus: 'partial' }), false);
  assert.match(
    getOrderDeleteBlockReason({ status: 'delivered', paymentStatus: 'pending' }),
    /payment is pending/i
  );
  assert.match(
    getOrderDeleteBlockReason({ status: 'confirmed', paymentStatus: 'paid' }),
    /delivered and paid/i
  );
  assert.equal(getOrderDeleteBlockReason({ status: 'delivered', paymentStatus: 'paid' }), '');
});
