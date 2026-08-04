import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryDedupKey,
  dedupeCategoryStrings,
  dedupeCategoryRowsCaseInsensitive
} from '../utils/categoryNormalize.js';

test('categoryDedupKey treats casing as equivalent', () => {
  assert.equal(categoryDedupKey('Flasks & Bottles'), categoryDedupKey('flasks & bottles'));
});

test('dedupeCategoryStrings keeps one entry for case variants', () => {
  const values = dedupeCategoryStrings(['flasks & bottles', 'Flasks & Bottles', 'Steel']);
  assert.deepEqual(values, ['flasks & bottles', 'Steel']);
});

test('dedupeCategoryRowsCaseInsensitive keeps first row for duplicate keys', () => {
  const rows = dedupeCategoryRowsCaseInsensitive([
    { name: 'flasks & bottles', displayName: 'Flasks & bottles' },
    { name: 'Flasks & Bottles', displayName: 'Flasks & Bottles' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'flasks & bottles');
});
