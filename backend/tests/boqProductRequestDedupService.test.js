import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBoqProductRequestKey,
  normalizeBoqProductRequestName
} from '../services/boqProductRequestDedupService.js';

test('buildBoqProductRequestKey uses BOQ item id when available', () => {
  const key = buildBoqProductRequestKey({
    boqId: '11111111-1111-1111-1111-111111111111',
    boqItemId: 3,
    name: 'Asian paints'
  });
  assert.equal(key, '11111111-1111-1111-1111-111111111111:item:3');
});

test('buildBoqProductRequestKey falls back to normalized product name before BOQ is saved', () => {
  const key = buildBoqProductRequestKey({
    boqId: null,
    boqItemId: 2,
    name: '  Asian   paints '
  });
  assert.equal(key, 'draft:item:2');
});

test('normalizeBoqProductRequestName lowercases and collapses whitespace', () => {
  assert.equal(normalizeBoqProductRequestName('  Asian   Paints '), 'asian paints');
});
