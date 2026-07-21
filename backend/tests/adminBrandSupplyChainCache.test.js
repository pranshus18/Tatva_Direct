import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAdminBrandTerminalRoleMapCache,
  loadAdminBrandTerminalRoleMap
} from '../utils/adminBrandSupplyChain.js';

test('loadAdminBrandTerminalRoleMap caches full map across calls', async () => {
  clearAdminBrandTerminalRoleMapCache();

  let selectCalls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'category_supply_chains');
      return {
        select() {
          selectCalls += 1;
          return Promise.resolve({
            data: [
              {
                category_name: 'Ultratech',
                stages: [{ role: 'manufacturer' }, { role: 'local_distributor' }, { role: 'dealer' }]
              }
            ],
            error: null
          });
        }
      };
    }
  };

  const first = await loadAdminBrandTerminalRoleMap(supabase, []);
  const second = await loadAdminBrandTerminalRoleMap(supabase, []);
  const filtered = await loadAdminBrandTerminalRoleMap(supabase, ['Ultratech']);

  assert.equal(selectCalls, 1);
  assert.equal(first.get('ultratech'), 'dealer');
  assert.equal(second.get('ultratech'), 'dealer');
  assert.equal(filtered.get('ultratech'), 'dealer');
  assert.equal(filtered.size, 1);
});
