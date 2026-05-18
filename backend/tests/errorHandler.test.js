import test from 'node:test';
import assert from 'node:assert/strict';
import { globalErrorHandler } from '../middleware/errorHandler.js';

function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test('globalErrorHandler maps JsonWebTokenError to 401', () => {
  const res = mockRes();
  const err = new Error('invalid');
  err.name = 'JsonWebTokenError';

  globalErrorHandler(err, {}, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, 'error');
});

test('globalErrorHandler hides internal details in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = mockRes();
  const err = new Error('secret db connection string leaked');

  globalErrorHandler(err, {}, res, () => {});
  process.env.NODE_ENV = prev;

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Internal server error');
});

test('globalErrorHandler returns Zod validation message', () => {
  const res = mockRes();
  const err = new Error('Invalid email');
  err.name = 'ZodError';

  globalErrorHandler(err, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid email');
});
