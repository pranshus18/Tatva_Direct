import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrandKey } from '../services/supplyChainSharedService.js';

test('normalizeBrandKey: case-insensitive brand keys', () => {
  assert.equal(normalizeBrandKey('ACC'), normalizeBrandKey('acc'));
});

test('listApprovedCatalogBrands merges Philips and Phillips spellings', async () => {
  const { listApprovedCatalogBrands } = await import('../services/supplierBrandCatalogService.js');
  const supabase = {
    from(table) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        order() {
          if (table === 'brands') {
            return Promise.resolve({
              data: [
                { id: '1', name: 'Phillips', normalized_name: 'phillips', status: 'approved' },
                { id: '2', name: 'Philips', normalized_name: 'philips', status: 'approved' },
                { id: '3', name: 'ACC', normalized_name: 'acc', status: 'approved' }
              ],
              error: null
            });
          }
          if (table === 'category_supply_chains') {
            return Promise.resolve({
              data: [
                {
                  category_name: 'samsung',
                  stages: [{ role: 'manufacturer' }, { role: 'retailer' }]
                }
              ],
              error: null
            });
          }
          return Promise.resolve({ data: [], error: null });
        }
      };
      return api;
    }
  };

  const brands = await listApprovedCatalogBrands(supabase);
  assert.equal(brands.length, 3);
  assert.deepEqual(
    brands.map((row) => row.name).sort(),
    ['ACC', 'Philips', 'samsung']
  );
  const samsung = brands.find((row) => row.name === 'samsung');
  assert.equal(samsung?.hasAdminSupplyChain, true);
});
