import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCategorySupplyChainRowForBrandKey,
  normalizeChainRolesFromStages,
  prepareSupplyChainStagesForSave
} from '../services/supplyChainSharedService.js';

test('prepareSupplyChainStagesForSave: sorts manual stages regardless of UI order', () => {
  const result = prepareSupplyChainStagesForSave([
    { role: 'retailer', notes: 'end' },
    { role: 'manufacturer', notes: 'start' },
    { role: 'dealer', notes: 'mid' }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.stages.map((s) => s.role),
    ['manufacturer', 'dealer', 'retailer']
  );
});

test('prepareSupplyChainStagesForSave: merges duplicate role picks', () => {
  const result = prepareSupplyChainStagesForSave([
    { role: 'manufacturer', notes: 'a' },
    { role: 'manufacturer', notes: 'b' },
    { role: 'dealer', notes: '' }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.stages.map((s) => s.role), ['manufacturer', 'dealer']);
  assert.equal(result.stages[0].notes, 'a');
});

test('normalizeChainRolesFromStages: canonical order for supplier role options', () => {
  const roles = normalizeChainRolesFromStages([
    { role: 'retailer' },
    { role: 'stockist' },
    { role: 'manufacturer' }
  ]);
  assert.deepEqual(roles, ['manufacturer', 'stockist', 'retailer']);
});

test('findCategorySupplyChainRowForBrandKey: prefers latest updated chain', () => {
  const rows = [
    {
      category_name: 'Asian Paints',
      stages: [
        { role: 'manufacturer' },
        { role: 'stockist' },
        { role: 'dealer' },
        { role: 'retailer' }
      ],
      updated_at: '2024-01-01T00:00:00.000Z'
    },
    {
      category_name: 'asian paints',
      stages: [{ role: 'manufacturer' }, { role: 'dealer' }, { role: 'retailer' }],
      updated_at: '2026-06-01T00:00:00.000Z'
    }
  ];
  const picked = findCategorySupplyChainRowForBrandKey(rows, 'asian paints');
  assert.equal(picked?.updated_at, '2026-06-01T00:00:00.000Z');
  assert.deepEqual(normalizeChainRolesFromStages(picked?.stages), [
    'manufacturer',
    'dealer',
    'retailer'
  ]);
});

test('findCategorySupplyChainRowForBrandKey: matches spelling variants via dedup key', () => {
  const rows = [
    {
      category_name: 'Philips',
      stages: [{ role: 'manufacturer' }, { role: 'dealer' }, { role: 'retailer' }],
      updated_at: '2026-06-01T00:00:00.000Z'
    }
  ];
  const picked = findCategorySupplyChainRowForBrandKey(rows, 'Phillips');
  assert.equal(picked?.category_name, 'Philips');
  assert.deepEqual(normalizeChainRolesFromStages(picked?.stages), [
    'manufacturer',
    'dealer',
    'retailer'
  ]);
});
