import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRequestReturnForOrder,
  getRemainingReturnableQuantity,
  getReturnRequestBlockReason,
  isSupplierBuyerUser,
  isValidSupplierReturnTransition
} from '../utils/orderReturnRules.js';

test('canRequestReturnForOrder allows only delivered orders', () => {
  assert.equal(canRequestReturnForOrder({ status: 'delivered' }), true);
  assert.equal(canRequestReturnForOrder({ status: 'shipped' }), false);
  assert.equal(canRequestReturnForOrder({ status: 'cancelled' }), false);
});

test('canRequestReturnForOrder blocks when all units are already returned', () => {
  const order = {
    status: 'delivered',
    items: [{ id: 'item-1', quantity: 3 }],
    returns: [{ order_item_id: 'item-1', quantity: 3, status: 'closed' }]
  };
  assert.equal(canRequestReturnForOrder(order), false);
  assert.match(getReturnRequestBlockReason(order), /closed/i);
});

test('canRequestReturnForOrder allows partial remaining quantity', () => {
  const order = {
    status: 'delivered',
    items: [{ id: 'item-1', quantity: 5 }],
    returns: [{ order_item_id: 'item-1', quantity: 3, status: 'closed' }]
  };
  assert.equal(canRequestReturnForOrder(order), true);
});

test('getReturnRequestBlockReason explains ineligible orders', () => {
  assert.equal(getReturnRequestBlockReason({ status: 'delivered' }), '');
  assert.match(getReturnRequestBlockReason({ status: 'shipped' }), /delivered/i);
  assert.match(getReturnRequestBlockReason({ status: 'cancelled' }), /cancelled/i);
});

test('isValidSupplierReturnTransition matches supplier workflow', () => {
  assert.equal(isValidSupplierReturnTransition('requested', 'approved'), true);
  assert.equal(isValidSupplierReturnTransition('approved', 'picked_up'), true);
  assert.equal(isValidSupplierReturnTransition('requested', 'closed'), false);
  assert.equal(isValidSupplierReturnTransition('closed', 'approved'), false);
});

test('isSupplierBuyerUser detects supplier buyers in upstream chain', () => {
  assert.equal(isSupplierBuyerUser('supplier'), true);
  assert.equal(isSupplierBuyerUser('service_provider'), false);
});

test('getRemainingReturnableQuantity ignores rejected returns', () => {
  const remaining = getRemainingReturnableQuantity(10, [
    { quantity: 3, status: 'requested' },
    { quantity: 4, status: 'rejected' },
    { quantity: 2, status: 'closed' }
  ]);
  assert.equal(remaining, 5);
});
