import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDiscoveryItemAsNewProject,
  consolidateDuplicateProductLines,
  mergeOrAppendCartGroupItem,
  applyUpstreamSelectedMineQuantitiesToItems,
  mergeOrAppendUpstreamCartItem,
  mergeUpstreamSelectedMineMaps,
  mergeUpstreamSelectedMineQuantity,
  normalizePoCartDraft,
  poCartDraftNeedsPersistAfterPrune,
  prunePoCartGroups,
  pruneUpstreamCartProjectsToLiveMineIds,
  removeUpstreamCartItemsByMineIds,
  resolveUpstreamProjectItems
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

test('mergeOrAppendUpstreamCartItem keeps quantity unchanged when no add is performed', () => {
  const existingItems = [
    {
      id: 'line-red',
      mineSupplierProductId: 'mine-red',
      quantity: 1
    }
  ];
  const unchanged = mergeOrAppendUpstreamCartItem(existingItems, {
    mineSupplierProductId: 'mine-red',
    quantity: 0
  });
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0].quantity, 1);
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

test('applyUpstreamSelectedMineQuantitiesToItems replaces quantity on existing lines', () => {
  const nextItems = applyUpstreamSelectedMineQuantitiesToItems(
    [
      {
        id: 'line-watch',
        mineSupplierProductId: 'mine-watch',
        quantity: 2
      },
      {
        id: 'line-band',
        mineSupplierProductId: 'mine-band',
        quantity: 1
      }
    ],
    { 'mine-watch': 5 }
  );
  assert.equal(nextItems.length, 2);
  assert.equal(nextItems[0].quantity, 5);
  assert.equal(nextItems[1].quantity, 1);
});

test('applyUpstreamSelectedMineQuantitiesToItems does not append new mine ids', () => {
  const nextItems = applyUpstreamSelectedMineQuantitiesToItems(
    [{ id: 'line-watch', mineSupplierProductId: 'mine-watch', quantity: 2 }],
    { 'mine-watch': 2, 'mine-band': 1 },
    { 'mine-band': { name: 'Band', productId: 'p-band' } }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'mine-watch');
  assert.equal(nextItems[0].quantity, 2);
});

test('applyUpstreamSelectedMineQuantitiesToItems appends new mine ids when appendNew is true', () => {
  const nextItems = applyUpstreamSelectedMineQuantitiesToItems(
    [{ id: 'line-watch', mineSupplierProductId: 'mine-watch', quantity: 2 }],
    { 'mine-watch': 2, 'mine-band': 1 },
    { 'mine-band': { name: 'Band', productId: 'p-band' } },
    { appendNew: true }
  );
  assert.equal(nextItems.length, 2);
  assert.equal(nextItems[0].quantity, 2);
  assert.equal(nextItems[1].mineSupplierProductId, 'mine-band');
  assert.equal(nextItems[1].quantity, 1);
});

test('mergeOrAppendUpstreamCartItem does not add a new line with quantity 0', () => {
  const nextItems = mergeOrAppendUpstreamCartItem(
    [{ id: 'line-blue', mineSupplierProductId: 'mine-blue', quantity: 2 }],
    { mineSupplierProductId: 'mine-red', quantity: 0 }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'mine-blue');
});

test('mergeOrAppendUpstreamCartItem replaceQuantity 0 removes the matching line', () => {
  const nextItems = mergeOrAppendUpstreamCartItem(
    [
      {
        id: 'line-red',
        mineSupplierProductId: 'mine-red',
        productId: 'p1',
        quantity: 5
      },
      {
        id: 'line-blue',
        mineSupplierProductId: 'mine-blue',
        productId: 'p2',
        quantity: 2
      }
    ],
    {
      mineSupplierProductId: 'mine-red',
      productId: 'p1',
      quantity: 0
    },
    { replaceQuantity: true }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'mine-blue');
});

test('mergeOrAppendUpstreamCartItem replaceQuantity does not add a missing line', () => {
  const nextItems = mergeOrAppendUpstreamCartItem(
    [{ id: 'line-watch', mineSupplierProductId: 'mine-watch', quantity: 2 }],
    { mineSupplierProductId: 'mine-band', quantity: 1 },
    { replaceQuantity: true }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'mine-watch');
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

test('removeUpstreamCartItemsByMineIds drops ordered lines and empty projects', () => {
  const next = removeUpstreamCartItemsByMineIds(
    [
      {
        projectId: 'proj-1',
        selectedMine: { 'mine-a': 4, 'mine-b': 2 },
        selectedUpstreamOffer: { 'mine-a': 'offer-a', 'mine-b': 'offer-b' },
        items: [
          { mineSupplierProductId: 'mine-a', quantity: 4 },
          { mineSupplierProductId: 'mine-b', quantity: 2 }
        ],
        suggestions: [{ mineSupplierProductId: 'mine-a' }, { mineSupplierProductId: 'mine-b' }]
      },
      {
        projectId: 'proj-2',
        items: [{ mineSupplierProductId: 'mine-a', quantity: 1 }]
      }
    ],
    ['mine-a']
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].projectId, 'proj-1');
  assert.equal(next[0].items.length, 1);
  assert.equal(next[0].items[0].mineSupplierProductId, 'mine-b');
  assert.deepEqual(next[0].selectedMine, { 'mine-b': 2 });
  assert.equal(next[0].selectedUpstreamOffer['mine-a'], undefined);
  assert.equal(next[0].suggestions.length, 1);
  assert.equal(next[0].suggestions[0].mineSupplierProductId, 'mine-b');
});

test('removeUpstreamCartItemsByMineIds clears the cart when every line was ordered', () => {
  const next = removeUpstreamCartItemsByMineIds(
    [
      {
        projectId: 'proj-1',
        items: [{ mineSupplierProductId: 'mine-a', quantity: 4 }]
      }
    ],
    ['mine-a']
  );
  assert.equal(next.length, 0);
});

test('resolveUpstreamProjectItems keeps an explicit empty items list empty', () => {
  const items = resolveUpstreamProjectItems({
    items: [],
    selectedMine: { 'mine-a': 4 }
  });
  assert.equal(items.length, 0);
});

test('resolveUpstreamProjectItems falls back to selectedMine when items are omitted', () => {
  const items = resolveUpstreamProjectItems({
    selectedMine: { 'mine-a': 4 }
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].mineSupplierProductId, 'mine-a');
  assert.equal(items[0].quantity, 4);
});

test('mergeOrAppendUpstreamCartItem does not treat cart line id as the offer id', () => {
  const nextItems = mergeOrAppendUpstreamCartItem(
    [{ id: 'us-item-old', mineSupplierProductId: 'mine-red', quantity: 5 }],
    { id: 'us-item-old', mineSupplierProductId: 'mine-blue', quantity: 0 },
    { replaceQuantity: true }
  );
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'mine-red');
});

test('pruneUpstreamCartProjectsToLiveMineIds drops deleted offer ids and keeps live lines', () => {
  const next = pruneUpstreamCartProjectsToLiveMineIds(
    [
      {
        projectId: 'proj-backpack',
        selectedMine: { 'stale-offer': 4, 'live-offer': 3 },
        items: [
          {
            mineSupplierProductId: 'stale-offer',
            productId: 'prod-1',
            name: 'Safari Omega 30L Laptop Backpack',
            quantity: 4
          },
          {
            mineSupplierProductId: 'live-offer',
            productId: 'prod-1',
            name: 'Safari Omega 30L Laptop Backpack',
            quantity: 3
          }
        ]
      }
    ],
    ['live-offer']
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].items.length, 1);
  assert.equal(next[0].items[0].mineSupplierProductId, 'live-offer');
  assert.equal(next[0].items[0].quantity, 3);
  assert.deepEqual(next[0].selectedMine, { 'live-offer': 3 });
});

test('pruneUpstreamCartProjectsToLiveMineIds removes a project that only had deleted offers', () => {
  const next = pruneUpstreamCartProjectsToLiveMineIds(
    [
      {
        projectId: 'proj-backpack',
        selectedMine: { 'stale-offer': 4 },
        items: [{ mineSupplierProductId: 'stale-offer', quantity: 4 }]
      },
      {
        projectId: 'proj-other',
        selectedMine: { 'live-offer': 2 },
        items: [{ mineSupplierProductId: 'live-offer', quantity: 2 }]
      }
    ],
    ['live-offer']
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].projectId, 'proj-other');
});

test('re-add after pruning a deleted offer keeps a single live line with the new quantity', () => {
  const afterDelete = pruneUpstreamCartProjectsToLiveMineIds(
    [
      {
        projectId: 'proj-backpack',
        selectedMine: { 'stale-offer': 4 },
        items: [
          {
            mineSupplierProductId: 'stale-offer',
            productId: 'prod-1',
            quantity: 4
          }
        ]
      }
    ],
    ['recreated-offer']
  );
  assert.equal(afterDelete.length, 0);

  const nextItems = mergeOrAppendUpstreamCartItem(afterDelete[0]?.items || [], {
    mineSupplierProductId: 'recreated-offer',
    productId: 'prod-1',
    quantity: 3
  });
  assert.equal(nextItems.length, 1);
  assert.equal(nextItems[0].mineSupplierProductId, 'recreated-offer');
  assert.equal(nextItems[0].quantity, 3);
});
