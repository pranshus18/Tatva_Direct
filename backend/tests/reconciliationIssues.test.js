import test from 'node:test';
import assert from 'node:assert/strict';
import { mapOrderMethodToTxnMethod } from '../services/paymentTransactionService.js';

test('mapOrderMethodToTxnMethod maps platform payment methods to transaction methods', () => {
  assert.equal(mapOrderMethodToTxnMethod('upi'), 'upi');
  assert.equal(mapOrderMethodToTxnMethod('cash'), 'bank_transfer');
  assert.equal(mapOrderMethodToTxnMethod('credit'), 'credit_line');
  assert.equal(mapOrderMethodToTxnMethod('online'), 'netbanking');
});
