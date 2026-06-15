import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrandKey } from '../services/supplyChainSharedService.js';

test('normalizeBrandKey: case-insensitive brand keys', () => {
  assert.equal(normalizeBrandKey('ACC'), normalizeBrandKey('acc'));
});

test('listApprovedCatalogBrands merges Philips and Phillips spellings', async () => {
  const { listApprovedCatalogBrands } = await import('../services/supplierBrandCatalogService.js');
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return Promise.resolve({
            data: [
              { id: '1', name: 'Phillips', normalized_name: 'phillips', status: 'approved' },
              { id: '2', name: 'Philips', normalized_name: 'philips', status: 'approved' },
              { id: '3', name: 'ACC', normalized_name: 'acc', status: 'approved' }
            ],
            error: null
          });
        }
      };
    }
  };

  const brands = await listApprovedCatalogBrands(supabase);
  assert.equal(brands.length, 2);
  assert.deepEqual(
    brands.map((row) => row.name).sort(),
    ['ACC', 'Philips']
  );
});
