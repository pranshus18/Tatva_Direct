import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllowedUpstreamRolesSet,
  findUpstreamRoleWalkback,
  loadAdminBrandChainsByName,
  pickMatchingUpstreamRoleForSeller,
  resolveRequiredUpstreamRoleFromAdminChain
} from '../services/supplierChainRoutingService.js';

test('resolveRequiredUpstreamRoleFromAdminChain: retailer buys from dealer per admin chain', () => {
  const chainRow = {
    category_name: 'apple',
    stages: [
      { role: 'manufacturer' },
      { role: 'stockist' },
      { role: 'regional_distributor' },
      { role: 'local_distributor' },
      { role: 'dealer' },
      { role: 'retailer' }
    ]
  };
  const profile = {
    supplierRole: 'retailer',
    companyInfoEntries: [{ role: 'retailer', brands: 'apple' }]
  };

  const routing = resolveRequiredUpstreamRoleFromAdminChain({
    profile,
    brandKey: 'apple',
    chainRow
  });

  assert.equal(routing.source, 'admin_chain');
  assert.equal(routing.buyerRole, 'retailer');
  assert.equal(routing.requiredUpstreamRole, 'dealer');
});

test('resolveRequiredUpstreamRoleFromAdminChain: retailer buys from local distributor when dealer skipped', () => {
  const chainRow = {
    category_name: 'apple',
    stages: [
      { role: 'manufacturer' },
      { role: 'stockist' },
      { role: 'local_distributor' },
      { role: 'retailer' }
    ]
  };
  const profile = {
    supplierRole: 'retailer',
    companyInfoEntries: [{ role: 'retailer', brands: 'apple' }]
  };

  const routing = resolveRequiredUpstreamRoleFromAdminChain({
    profile,
    brandKey: 'apple',
    chainRow
  });

  assert.equal(routing.source, 'admin_chain');
  assert.equal(routing.buyerRole, 'retailer');
  assert.equal(routing.requiredUpstreamRole, 'local_distributor');
});

test('findUpstreamRoleWalkback: skips dealer tier when absent from admin chain', () => {
  const required = findUpstreamRoleWalkback('retailer', [
    'manufacturer',
    'stockist',
    'local_distributor'
  ]);
  assert.equal(required, 'local_distributor');
});

test('buildAllowedUpstreamRolesSet: allows only local distributors for retailer on dealer-less chain', () => {
  const chainRow = {
    category_name: 'apple',
    stages: [
      { role: 'manufacturer' },
      { role: 'local_distributor' }
    ]
  };
  const profile = {
    supplierRole: 'retailer',
    companyInfoEntries: [{ role: 'retailer', brands: 'apple' }]
  };
  const parentRolesUnion = new Set(['dealer']);

  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey: 'apple',
    chainRow,
    parentRolesUnion
  });

  assert.equal(allowedRolesSet.size, 1);
  assert.equal(allowedRolesSet.has('local_distributor'), true);
  assert.equal(allowedRolesSet.has('dealer'), false);
  assert.equal(chainRouting.requiredUpstreamRole, 'local_distributor');
});

test('loadAdminBrandChainsByName: fuzzy-matches apple product brand to Apple Inc chain', async () => {
  const supabase = {
    from() {
      return {
        select: async () => ({
          data: [
            {
              id: '1',
              category_name: 'Apple Inc',
              stages: [{ role: 'manufacturer' }, { role: 'dealer' }, { role: 'retailer' }]
            }
          ],
          error: null
        })
      };
    }
  };

  const map = await loadAdminBrandChainsByName({ supabase, brandNames: ['apple'] });
  assert.equal(map.has('apple'), true);
  assert.equal(map.get('apple')?.category_name, 'Apple Inc');
});

test('pickMatchingUpstreamRoleForSeller: prefers nearest upstream tier (dealer over local_distributor)', () => {
  const sellerProfile = {
    companyInfoEntries: [
      { role: 'local_distributor', brands: 'apple' },
      { role: 'dealer', brands: 'acc' }
    ]
  };
  const allowed = new Set(['local_distributor', 'dealer']);
  assert.equal(pickMatchingUpstreamRoleForSeller(sellerProfile, allowed), 'dealer');
  assert.equal(pickMatchingUpstreamRoleForSeller(sellerProfile, new Set(['dealer'])), 'dealer');
});
