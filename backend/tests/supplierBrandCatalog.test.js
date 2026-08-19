import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrandKey } from '../services/supplyChainSharedService.js';

test('normalizeBrandKey: case-insensitive brand keys', () => {
  assert.equal(normalizeBrandKey('ACC'), normalizeBrandKey('acc'));
});

test('listApprovedCatalogBrands uses brands-table approval only and marks supply-chain readiness', async () => {
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
                },
                {
                  category_name: 'ACC',
                  stages: [{ role: 'manufacturer' }, { role: 'dealer' }]
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
  // samsung has a supply chain but is NOT in brands.status=approved — must not appear.
  assert.equal(brands.length, 3);
  assert.deepEqual(
    brands.map((row) => row.name).sort(),
    ['ACC', 'Philips', 'Phillips']
  );
  const acc = brands.find((row) => row.name === 'ACC');
  assert.equal(acc?.hasAdminSupplyChain, true);
  assert.equal(brands.some((row) => /samsung/i.test(row.name)), false);
});
