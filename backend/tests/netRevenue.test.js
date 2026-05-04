import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderNetRevenueMap, getNetItemMetrics } from '../utils/netRevenue.js';

test('getNetItemMetrics computes net quantity and revenue after returns', () => {
  const returnsByItem = new Map([['item-1', 2]]);
  const item = {
    id: 'item-1',
    quantity: 5,
    unit_price: 100
  };

  const metrics = getNetItemMetrics(item, returnsByItem);

  assert.equal(metrics.qty, 5);
  assert.equal(metrics.returnedQty, 2);
  assert.equal(metrics.netQty, 3);
  assert.equal(metrics.netRevenue, 300);
});

test('buildOrderNetRevenueMap aggregates net revenue per order', () => {
  const returnsByItem = new Map([
    ['item-1', 1],
    ['item-3', 5]
  ]);
  const orderItems = [
    { id: 'item-1', order_id: 'order-a', quantity: 4, unit_price: 50 },
    { id: 'item-2', order_id: 'order-a', quantity: 2, unit_price: 100 },
    { id: 'item-3', order_id: 'order-b', quantity: 3, unit_price: 200 }
  ];

  const revenueMap = buildOrderNetRevenueMap(orderItems, returnsByItem);

  assert.equal(revenueMap.get('order-a'), 350);
  assert.equal(revenueMap.get('order-b'), 0);
});
