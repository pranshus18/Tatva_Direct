import test from 'node:test';
import assert from 'node:assert/strict';
import { asyncHandler } from '../middleware/asyncHandler.js';

test('asyncHandler forwards rejected promises to next', async () => {
  const err = new Error('boom');
  const handler = asyncHandler(async () => {
    throw err;
  });

  let forwarded = null;
  await new Promise((resolve) => {
    handler({}, {}, (e) => {
      forwarded = e;
      resolve();
    });
  });

  assert.equal(forwarded, err);
});

test('asyncHandler passes through successful handlers', async () => {
  let called = false;
  const handler = asyncHandler(async (_req, res) => {
    called = true;
    res.status(200).end();
  });

  const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, end() {} };
  await handler({}, res, () => {});

  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});
