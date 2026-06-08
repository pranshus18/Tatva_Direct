import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrandKey } from '../services/supplyChainSharedService.js';

test('normalizeBrandKey: case-insensitive brand keys', () => {
  assert.equal(normalizeBrandKey('ACC'), normalizeBrandKey('acc'));
});
