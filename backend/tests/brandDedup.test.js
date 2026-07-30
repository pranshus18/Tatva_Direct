import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateDuplicateBrands,
  getCanonicalBrandNormalizedName,
  pickCanonicalBrandDisplayName
} from '../services/brandDedupService.js';

test('getCanonicalBrandNormalizedName merges Philips and Phillips', () => {
  assert.equal(getCanonicalBrandNormalizedName('Philips'), 'philips');
  assert.equal(getCanonicalBrandNormalizedName('Phillips'), 'philips');
});

test('pickCanonicalBrandDisplayName prefers shorter spelling', () => {
  assert.equal(pickCanonicalBrandDisplayName('Phillips', 'Philips'), 'Philips');
});

test('findApprovedCatalogBrandCloseMatch is exact identity only', async () => {
  const { findApprovedCatalogBrandCloseMatch } = await import('../services/brandDedupService.js');
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

  const exact = await findApprovedCatalogBrandCloseMatch('Sparsh', dbClient);
  assert.equal(exact.data?.name, 'Sparsh');
  assert.equal(exact.matchType, 'exact');

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
  assert.equal(phillipsVariant.data?.name, 'Philips');
  assert.equal(phillipsVariant.matchType, 'exact');
});

test('consolidateDuplicateBrands keeps one approved Philips row', async () => {
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

  assert.deepEqual(approvedNames, ['ACC', 'Philips']);
  assert.equal(rows.find((row) => row.id === '1')?.status, 'rejected');
  assert.equal(rows.find((row) => row.id === '2')?.normalized_name, 'philips');
});
