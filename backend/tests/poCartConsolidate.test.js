import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDiscoveryItemAsNewProject,
  consolidateDuplicateProductLines,
  mergeOrAppendCartGroupItem,
  mergeOrAppendUpstreamCartItem,
  mergeUpstreamSelectedMineMaps,
  mergeUpstreamSelectedMineQuantity,
  normalizePoCartDraft,
  poCartDraftNeedsPersistAfterPrune,
  prunePoCartGroups
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
  assert.equal(first.boqGroups[0].boqName, 'Cement');
  assert.equal(first.boqGroups[0].items[0].quantity, 2);

  const second = appendDiscoveryItemAsNewProject(
    first.boqGroups,
    { id: 'pd-item-2', productId: 'p1', name: 'Cement', quantity: 5, unit: 'bag' },
    'Cement'
  );
  assert.equal(second.boqGroups.length, 2);
  assert.notEqual(second.boqGroups[0].groupId, second.boqGroups[1].groupId);
  assert.equal(second.boqGroups[0].items[0].quantity, 5);
});

test('prunePoCartGroups removes zero-qty lines and empty projects', () => {
  const groups = prunePoCartGroups([
    {
      groupId: 'g1',
      boqName: 'Light',
      items: [{ id: 'a', productId: 'p1', quantity: 0 }]
    },
    {
      groupId: 'g2',
      boqName: 'Cement',
      items: [{ id: 'b', productId: 'p2', quantity: 2 }]
    }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].boqName, 'Cement');
  assert.equal(groups[0].items[0].quantity, 2);
});

test('mergeOrAppendCartGroupItem increases quantity when the same product and variant is re-added to the same project', () => {
  const existingItems = [{ id: 'a', productId: 'p1', variantKey: 'vk-red', name: 'Mac Air M1', quantity: 1 }];
  const nextItems = mergeOrAppendCartGroupItem(existingItems, {
    id: 'pd-item-new',
    productId: 'p1',
    variantKey: 'vk-red',
    name: 'Mac Air M1',
    quantity: 1
  });
  assert.equal(nextItems.length, 1, 'must not create a duplicate row for the same product+variant');
  assert.equal(nextItems[0].id, 'a', 'the original line id is kept, only quantity changes');
  assert.equal(nextItems[0].quantity, 2);
});

test('mergeOrAppendCartGroupItem appends a separate row when the same product has a different variant', () => {
  const existingItems = [{ id: 'a', productId: 'p1', variantKey: 'vk-red', name: 'Mac Air M1', quantity: 1 }];
  const nextItems = mergeOrAppendCartGroupItem(existingItems, {
    id: 'pd-item-new',
    productId: 'p1',
    variantKey: 'vk-blue',
    name: 'Mac Air M1',
    quantity: 1
  });
  assert.equal(nextItems.length, 2, 'different variants must stay as separate cart lines');
  assert.equal(nextItems[0].quantity, 1);
  assert.equal(nextItems[1].variantKey, 'vk-blue');
  assert.equal(nextItems[1].quantity, 1);
});

test('mergeOrAppendCartGroupItem treats missing variantKey as the default variant bucket', () => {
  const existingItems = [{ id: 'a', productId: 'p1', name: 'Cement', quantity: 2 }];
  const nextItems = mergeOrAppendCartGroupItem(existingItems, {
    id: 'pd-item-new',
    productId: 'p1',
    name: 'Cement',
    quantity: 3
  });
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].quantity, 5);
});

test('mergeOrAppendCartGroupItem appends a new row for a different product in the same project', () => {
  const existingItems = [{ id: 'a', productId: 'p1', name: 'Mac Air M1', quantity: 1 }];
  const nextItems = mergeOrAppendCartGroupItem(existingItems, {
    id: 'pd-item-new',
    productId: 'p2',
    name: 'Mac Air M2',
    quantity: 1
  });
  assert.equal(nextItems.length, 2);
  assert.equal(nextItems[1].productId, 'p2');
});

test('mergeUpstreamSelectedMineQuantity increases quantity for the same supplier-product key', () => {
  const merged = mergeUpstreamSelectedMineQuantity({ 'sp-1': 2 }, 'sp-1', 3);
  assert.equal(merged, 5, 'same product re-added to the same project must add to the existing quantity');
});

test('mergeUpstreamSelectedMineQuantity starts fresh for a key not yet in the project', () => {
  const merged = mergeUpstreamSelectedMineQuantity({ 'sp-1': 2 }, 'sp-2', 3);
  assert.equal(merged, 3);
});

test('mergeOrAppendUpstreamCartItem keeps separate lines for the same product with different variants', () => {
  const existingItems = [
    {
      id: 'line-red',
      mineSupplierProductId: 'mine-red',
      productId: 'p1',
      variantKey: 'vk-red',
      quantity: 1
    }
  ];
  const nextItems = mergeOrAppendUpstreamCartItem(existingItems, {
    id: 'line-blue',
    mineSupplierProductId: 'mine-blue',
    productId: 'p1',
    variantKey: 'vk-blue',
    quantity: 2
  });
  assert.equal(nextItems.length, 2);
  assert.equal(nextItems[0].quantity, 1);
  assert.equal(nextItems[1].quantity, 2);
});

test('mergeOrAppendUpstreamCartItem increases quantity for the same product and variant', () => {
  const existingItems = [
    {
      id: 'line-red',
      mineSupplierProductId: 'mine-red',
      productId: 'p1',
      variantKey: 'vk-red',
      quantity: 1
    }
  ];
  const nextItems = mergeOrAppendUpstreamCartItem(existingItems, {
    id: 'line-red-again',
    mineSupplierProductId: 'mine-red',
    productId: 'p1',
    variantKey: 'vk-red',
    quantity: 3
  });
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].quantity, 4);
});

test('mergeOrAppendUpstreamCartItem replaces quantity when replaceQuantity is set', () => {
  const existingItems = [
    {
      id: 'line-red',
      mineSupplierProductId: 'mine-red',
      productId: 'p1',
      variantKey: 'vk-red',
      quantity: 5
    }
  ];
  const nextItems = mergeOrAppendUpstreamCartItem(
    existingItems,
    {
      id: 'line-red-set',
      mineSupplierProductId: 'mine-red',
      productId: 'p1',
      variantKey: 'vk-red',
      quantity: 2
    },
    { replaceQuantity: true }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].quantity, 2);
});

test('mergeUpstreamSelectedMineMaps adds new variant lines without removing existing ones', () => {
  const merged = mergeUpstreamSelectedMineMaps(
    { 'mine-red': 2 },
    { 'mine-blue': 3 }
  );
  assert.deepEqual(merged, { 'mine-red': 2, 'mine-blue': 3 });
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

test('normalizePoCartDraft clears stale flat items when boqGroups is empty after delete', () => {
  const draft = normalizePoCartDraft({
    boqGroups: [],
    items: [{ id: 'a', productId: 'p1', quantity: 1 }],
    selectedVendors: { a: 'vendor-1' }
  });
  assert.equal(draft.boqGroups.length, 0);
  assert.equal(draft.items.length, 0);
});

test('poCartDraftNeedsPersistAfterPrune detects stale flat items after group delete', () => {
  const rawDraft = {
    boqGroups: [],
    items: [{ id: 'a', productId: 'p1', quantity: 1 }]
  };
  const normalizedDraft = normalizePoCartDraft(rawDraft);
  assert.equal(normalizedDraft.items.length, 0);
  assert.equal(poCartDraftNeedsPersistAfterPrune(rawDraft, normalizedDraft), true);
});
