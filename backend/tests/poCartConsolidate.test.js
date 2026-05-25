import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDiscoveryItemAsNewProject,
  consolidateDuplicateProductLines,
  normalizePoCartDraft
} from '../controllers/po/shared/poHelpers.js';

test('consolidateDuplicateProductLines merges same productId when explicitly called', () => {
  const groups = consolidateDuplicateProductLines([
    {
      groupId: 'g1',
      items: [{ id: 'a', productId: 'p1', name: 'Mac Air M2', quantity: 1 }]
    },
    {
      groupId: 'g2',
      items: [{ id: 'b', productId: 'p1', name: 'Mac Air M2', quantity: 2 }]
    }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].quantity, 3);
});

test('appendDiscoveryItemAsNewProject creates a new group per add', () => {
  const item = {
    id: 'pd-item-1',
    productId: 'p1',
    name: 'Cement',
    quantity: 2,
    unit: 'bag'
  };
  const first = appendDiscoveryItemAsNewProject([], item, 'Cement');
  assert.equal(first.boqGroups.length, 1);
  assert.equal(first.boqGroups[0].boqName, 'Discovery - Cement');
  assert.equal(first.boqGroups[0].items[0].quantity, 2);

  const second = appendDiscoveryItemAsNewProject(
    first.boqGroups,
    { id: 'pd-item-2', productId: 'p1', name: 'Cement', quantity: 5, unit: 'bag' },
    'Cement'
  );
  assert.equal(second.boqGroups.length, 2);
  assert.notEqual(second.boqGroups[0].groupId, second.boqGroups[1].groupId);
  assert.equal(second.boqGroups[1].items[0].quantity, 5);
});

test('normalizePoCartDraft keeps separate lines for the same productId', () => {
  const draft = normalizePoCartDraft({
    boqGroups: [
      { groupId: 'g1', items: [{ id: 'a', productId: 'p1', quantity: 1 }] },
      { groupId: 'g2', items: [{ id: 'b', productId: 'p1', quantity: 2 }] }
    ]
  });
  assert.equal(draft.boqGroups.length, 2);
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].quantity, 1);
  assert.equal(draft.items[1].quantity, 2);
});
