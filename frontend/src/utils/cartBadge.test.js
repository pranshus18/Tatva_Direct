import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  countServiceProviderCartDraft,
  countSupplierUpstreamCartDraft,
  getServiceProviderCartGroups
} from '../utils/cartBadge.js';

test('countServiceProviderCartDraft counts cart lines not total quantity', () => {
  const count = countServiceProviderCartDraft({
    boqGroups: [
      {
        items: [
          { quantity: 5 },
          { quantity: 0 },
          { quantity: 6 }
        ]
      }
    ]
  });
  assert.equal(count, 2);
});

test('getServiceProviderCartGroups ignores empty groups', () => {
  const groups = getServiceProviderCartGroups({
    boqGroups: [
      { items: [] },
      { items: [{ quantity: 1 }] }
    ]
  });
  assert.equal(groups.length, 1);
  assert.equal(countServiceProviderCartDraft({ boqGroups: groups }), 1);
});

test('countServiceProviderCartDraft returns 0 for an empty cart', () => {
  assert.equal(countServiceProviderCartDraft(null), 0);
  assert.equal(countServiceProviderCartDraft({ boqGroups: [], items: [] }), 0);
});

test('countSupplierUpstreamCartDraft ignores zero-qty selections', () => {
  const count = countSupplierUpstreamCartDraft({
    selectedMine: {
      a: 0,
      b: 2,
      c: 0,
      d: 3
    }
  });
  assert.equal(count, 2);
});

test('countSupplierUpstreamCartDraft returns 0 when nothing is selected', () => {
  assert.equal(
    countSupplierUpstreamCartDraft({
      projects: [{ selectedMine: { a: 0, b: 0 } }]
    }),
    0
  );
});
