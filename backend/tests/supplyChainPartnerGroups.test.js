import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSupplyChainPartnerGroups,
  getImmediateUpstreamRoleForBrand,
  pickUpstreamSellerRoleForBrand,
  sellerHasRoleForBrand
} from '../services/supplyChainPartnerGroupsService.js';

test('sellerHasRoleForBrand: prans is dealer for acc, local distributor for apple', () => {
  const prans = {
    companyInfoEntries: [
      { role: 'local_distributor', brands: 'apple' },
      { role: 'dealer', brands: 'acc' }
    ]
  };
  assert.equal(sellerHasRoleForBrand(prans, 'dealer', 'acc'), true);
  assert.equal(sellerHasRoleForBrand(prans, 'local_distributor', 'apple'), true);
  assert.equal(sellerHasRoleForBrand(prans, 'dealer', 'apple'), false);
  assert.equal(sellerHasRoleForBrand(prans, 'local_distributor', 'acc'), false);
});

test('pickUpstreamSellerRoleForBrand: uses admin-required role for that brand', () => {
  const prans = {
    companyInfoEntries: [
      { role: 'local_distributor', brands: 'apple' },
      { role: 'dealer', brands: 'acc' }
    ]
  };
  assert.equal(
    pickUpstreamSellerRoleForBrand(prans, new Set(['dealer']), 'acc', {
      requiredUpstreamRole: 'dealer'
    }),
    'dealer'
  );
});

test('buildSupplyChainPartnerGroups: multi-brand retailer sees prans per brand tier', async () => {
  const retailerProfile = {
    supplierRole: 'retailer',
    companyInfoEntries: [
      { role: 'retailer', brands: 'apple' },
      { role: 'retailer', brands: 'acc' }
    ]
  };

  const prans = {
    id: 'p1',
    name: 'prans',
    company: 'tatva',
    phone: '',
    email: 'p@test.com',
    address: {},
    profile: {
      companyInfoEntries: [
        { role: 'local_distributor', brands: 'apple' },
        { role: 'dealer', brands: 'acc' }
      ]
    }
  };

  const supabase = {
    from(table) {
      if (table !== 'category_supply_chains') throw new Error('unexpected table');
      return {
        select: async () => ({
          data: [
            {
              category_name: 'acc',
              stages: [
                { role: 'manufacturer' },
                { role: 'stockist' },
                { role: 'dealer' },
                { role: 'retailer' }
              ],
              updated_at: '2026-06-01T00:00:00Z'
            },
            {
              category_name: 'apple',
              stages: [
                { role: 'manufacturer' },
                { role: 'local_distributor' },
                { role: 'retailer' }
              ],
              updated_at: '2026-06-01T00:00:00Z'
            }
          ],
          error: null
        })
      };
    }
  };

  const groups = await buildSupplyChainPartnerGroups({
    effectiveViewerProfile: retailerProfile,
    allSupplierRows: [prans],
    supabase
  });

  assert.equal(groups.length, 2);
  const accDealer = groups.find((g) => g.brand === 'acc' && g.parentRole === 'dealer');
  const appleLd = groups.find((g) => g.brand === 'apple' && g.parentRole === 'local_distributor');
  assert.ok(accDealer, 'acc dealer group missing');
  assert.equal(accDealer.partners.length, 1);
  assert.equal(accDealer.partners[0].name, 'prans');
  assert.ok(appleLd, 'apple local_distributor group missing');
  assert.equal(appleLd.partners.length, 1);
  assert.ok(!groups.some((g) => g.parentRole === 'manufacturer' || g.parentRole === 'stockist'));
});
