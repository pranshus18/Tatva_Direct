import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteOrderById } from '../repositories/ordersRepository.js';

function createMockDb({ notifError = null, orderError = null } = {}) {
  const calls = [];

  const makeBuilder = (table) => ({
    delete() {
      return {
        eq(column, value) {
          calls.push({ table, action: 'delete', column, value });
          const error = table === 'notifications' ? notifError : orderError;
          return Promise.resolve({ error });
        }
      };
    }
  });

  return {
    calls,
    from(table) {
      return makeBuilder(table);
    }
  };
}

test('deleteOrderById removes notifications before deleting the order', async () => {
  const db = createMockDb();
  const orderId = '781b2b27-202e-452f-8312-20d32bf8e37e';

  const result = await deleteOrderById(orderId, db);

  assert.equal(result.error, null);
  assert.deepEqual(db.calls, [
    { table: 'notifications', action: 'delete', column: 'related_order_id', value: orderId },
    { table: 'orders', action: 'delete', column: 'id', value: orderId }
  ]);
});

test('deleteOrderById stops when notification cleanup fails', async () => {
  const db = createMockDb({ notifError: { code: '23503', message: 'fk violation' } });
  const result = await deleteOrderById('order-1', db);

  assert.equal(result.error?.code, '23503');
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].table, 'notifications');
});
