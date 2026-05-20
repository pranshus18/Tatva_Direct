import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestTimeout } from '../utils/asyncTimeout.js';

test('withRequestTimeout resolves when promise finishes first', async () => {
  const result = await withRequestTimeout(Promise.resolve('ok'), 5000, 'test');
  assert.equal(result, 'ok');
});

test('withRequestTimeout rejects when promise is too slow', async () => {
  await assert.rejects(
    () =>
      withRequestTimeout(
        new Promise((resolve) => {
          setTimeout(() => resolve('late'), 200);
        }),
        50,
        'slow'
      ),
    (err) => err.code === 'ETIMEDOUT'
  );
});
