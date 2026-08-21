import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateDuplicateBrands,
  getCanonicalBrandNormalizedName,
  indexPreferredBrandRowsByCatalogKey,
  pickCanonicalBrandDisplayName,
  toSupplierBrandApprovalView,
  toSupplierProductCardBrandApprovalView
} from '../services/brandDedupService.js';

test('getCanonicalBrandNormalizedName keeps spelling variants distinct', () => {
  assert.equal(getCanonicalBrandNormalizedName('Philips'), 'philips');
  assert.equal(getCanonicalBrandNormalizedName('Phillips'), 'phillips');
  assert.notEqual(getCanonicalBrandNormalizedName('Philips'), getCanonicalBrandNormalizedName('Phillips'));
});

test('pickCanonicalBrandDisplayName prefers shorter spelling', () => {
  assert.equal(pickCanonicalBrandDisplayName('Phillips', 'Philips'), 'Philips');
});

test('findApprovedCatalogBrandCloseMatch matches exact spelling only', async () => {
  const { findApprovedCatalogBrandCloseMatch, isApprovedBrandNearTypo } = await import(
    '../services/brandDedupService.js'
  );
  const rows = [
    {
      id: '1',
      name: 'Sparsh',
      normalized_name: 'sparsh',
      status: 'approved',
      created_at: '2026-06-13T05:27:26.000Z'
    },
    {
      id: '2',
      name: 'samsung',
      normalized_name: 'samsung',
      status: 'approved',
      created_at: '2026-06-12T00:00:00.000Z'
    },
    {
      id: '4',
      name: 'Fastrack',
      normalized_name: 'fastrack',
      status: 'approved',
      created_at: '2026-08-07T00:00:00.000Z'
    }
  ];

  const dbClient = {
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({ data: rows, error: null });
        }
      };
    }
  };

  const sparsga = await findApprovedCatalogBrandCloseMatch('SPARSGA', dbClient);
  assert.equal(sparsga.data, null);
  assert.equal(sparsga.matchType, null);

  const samsun = await findApprovedCatalogBrandCloseMatch('samsun', dbClient);
  assert.equal(samsun.data, null);
  assert.equal(samsun.matchType, null);

  const faststark = await findApprovedCatalogBrandCloseMatch('Faststark', dbClient);
  assert.equal(faststark.data, null);
  assert.equal(faststark.matchType, null);
  assert.equal(isApprovedBrandNearTypo('Faststark', 'Fastrack'), true);

  const exact = await findApprovedCatalogBrandCloseMatch('Sparsh', dbClient);
  assert.equal(exact.data?.name, 'Sparsh');
  assert.equal(exact.matchType, 'exact');

  const safariRows = [
    ...rows,
    {
      id: '5',
      name: 'Safari',
      normalized_name: 'safari',
      status: 'approved',
      created_at: '2026-08-21T00:00:00.000Z'
    }
  ];
  const safariDb = {
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({ data: safariRows, error: null });
        }
      };
    }
  };
  const safarii = await findApprovedCatalogBrandCloseMatch('safarii', safariDb);
  assert.equal(safarii.data, null);
  assert.equal(safarii.matchType, null);
  const safariPrefix = await findApprovedCatalogBrandCloseMatch('safa', safariDb);
  assert.equal(safariPrefix.data, null);

  const phillipsVariant = await findApprovedCatalogBrandCloseMatch('phillips', {
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({
            data: [
              {
                id: '3',
                name: 'Philips',
                normalized_name: 'philips',
                status: 'approved',
                created_at: '2026-06-13T05:27:26.000Z'
              }
            ],
            error: null
          });
        }
      };
    }
  });
  assert.equal(phillipsVariant.data, null);
  assert.equal(phillipsVariant.matchType, null);
});

test('consolidateDuplicateBrands does not merge spelling variants', async () => {
  const rows = [
    {
      id: '1',
      name: 'Phillips',
      normalized_name: 'phillips',
      status: 'approved',
      created_at: '2026-06-13T05:27:26.000Z'
    },
    {
      id: '2',
      name: 'Philips',
      normalized_name: 'philips',
      status: 'approved',
      created_at: '2026-06-13T06:16:12.000Z'
    },
    {
      id: '3',
      name: 'ACC',
      normalized_name: 'acc',
      status: 'approved',
      created_at: '2026-06-12T00:00:00.000Z'
    }
  ];

  const dbClient = {
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return Promise.resolve({ data: rows, error: null });
        },
        eq(column, value) {
          this._eq = { column, value };
          return this;
        },
        update(payload) {
          this._update = payload;
          return this;
        },
        single() {
          const row = rows.find((item) => item.id === this._eq?.value);
          const next = row ? { ...row, ...this._update } : null;
          if (next) {
            const idx = rows.findIndex((item) => item.id === next.id);
            rows[idx] = next;
          }
          return Promise.resolve({ data: next, error: null });
        }
      };
    }
  };

  const consolidated = await consolidateDuplicateBrands(dbClient);
  const approvedNames = consolidated
    .filter((row) => row.status === 'approved')
    .map((row) => row.name)
    .sort();

  assert.deepEqual(approvedNames, ['ACC', 'Philips', 'Phillips']);
  assert.equal(rows.find((row) => row.id === '1')?.status, 'approved');
  assert.equal(rows.find((row) => row.id === '2')?.status, 'approved');
});

test('indexPreferredBrandRowsByCatalogKey prefers live pending Philips over auto-merged reject', () => {
  const preferred = indexPreferredBrandRowsByCatalogKey([
    {
      id: 'dup',
      name: 'Philips',
      normalized_name: 'philips',
      status: 'rejected',
      rejection_reason: 'Duplicate of "Philips" — merged automatically.',
      created_at: '2026-08-19T00:00:00.000Z'
    },
    {
      id: 'live',
      name: 'Philips',
      normalized_name: 'philips',
      status: 'pending',
      created_at: '2026-06-13T00:00:00.000Z'
    }
  ]);
  const row = preferred.get('philips');
  assert.equal(row?.id, 'live');
  assert.equal(row?.status, 'pending');
  const view = toSupplierBrandApprovalView(row, 'Philips');
  assert.equal(view.status, 'pending');
  assert.doesNotMatch(view.message, /rejected/i);
  assert.doesNotMatch(view.message, /merged automatically/i);
});

test('toSupplierBrandApprovalView does not treat auto-merge leftovers as admin rejection', () => {
  const view = toSupplierBrandApprovalView(
    {
      name: 'Philips',
      status: 'rejected',
      rejection_reason: 'Duplicate of "Philips" — merged automatically.'
    },
    'Philips'
  );
  assert.equal(view.status, 'unregistered');
  assert.doesNotMatch(view.message, /rejected/i);
  assert.doesNotMatch(view.message, /merged automatically/i);
});

test('toSupplierProductCardBrandApprovalView hides leftover brand rejection on approved products', () => {
  const preferred = indexPreferredBrandRowsByCatalogKey([
    {
      id: 'dup',
      name: 'Phillips',
      normalized_name: 'phillips',
      status: 'rejected',
      rejection_reason: 'Duplicate of "Philips" — merged automatically.'
    },
    {
      id: 'live',
      name: 'Philips',
      normalized_name: 'philips',
      status: 'approved'
    }
  ]);
  const view = toSupplierProductCardBrandApprovalView(
    {
      status: 'approved',
      brand: 'Philips',
      brandModel: 'Phillips',
      attributes: { brand: 'Philips', brandModel: 'Phillips' }
    },
    preferred
  );
  assert.equal(view.status, 'approved');
  assert.equal(view.message, '');
});

test('toSupplierProductCardBrandApprovalView follows duplicate-of merge to the live brand', () => {
  const preferred = indexPreferredBrandRowsByCatalogKey([
    {
      id: 'dup',
      name: 'Phillips',
      normalized_name: 'phillips',
      status: 'rejected',
      rejection_reason: 'Duplicate of "Philips" — merged automatically.'
    },
    {
      id: 'live',
      name: 'Philips',
      normalized_name: 'philips',
      status: 'approved'
    }
  ]);
  const view = toSupplierProductCardBrandApprovalView(
    {
      status: 'pending',
      brand: 'Phillips'
    },
    preferred
  );
  assert.equal(view.status, 'approved');
  assert.equal(view.message, '');
});
