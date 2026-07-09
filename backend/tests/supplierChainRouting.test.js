import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllowedUpstreamRolesSet,
  findUpstreamRoleWalkback,
  loadAdminBrandChainsByName,
  pickMatchingUpstreamRoleForSeller,
  resolveBuyerRoleForBrand,
  resolveRequiredUpstreamRoleFromAdminChain
} from '../services/supplierChainRoutingService.js';
import { roleDeclaresBrand } from '../services/supplierBrandGuardService.js';
import {
  pickAnyUpstreamSellerRoleOnChain,
  sellerHasRoleForBrand
} from '../services/supplyChainPartnerGroupsService.js';

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

test('roleDeclaresBrand: fuzzy-matches product brand to declared profile brand', () => {
  const profile = {
    companyInfoEntries: [{ role: 'retailer', brands: 'Havells' }]
  };
  assert.equal(roleDeclaresBrand(profile, 'retailer', 'Havells Electrical'), true);
  assert.equal(roleDeclaresBrand(profile, 'dealer', 'Havells'), false);
});

test('resolveBuyerRoleForBrand: picks retailer for apple brand when user holds dealer+retailer', () => {
  const profile = {
    companyInfoEntries: [
      { role: 'dealer', brands: 'acc' },
      { role: 'retailer', brands: 'apple' }
    ]
  };
  assert.equal(resolveBuyerRoleForBrand(profile, 'apple'), 'retailer');
  assert.equal(resolveBuyerRoleForBrand(profile, 'acc'), 'dealer');
});

test('buildAllowedUpstreamRolesSet: uses brand-specific buyer role for multi-role supplier', () => {
  const profile = {
    companyInfoEntries: [
      { role: 'dealer', brands: 'acc' },
      { role: 'retailer', brands: 'apple' }
    ]
  };
  const parentRolesUnion = new Set(['dealer', 'local_distributor']);

  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey: 'apple',
    chainRow: null,
    parentRolesUnion,
    buyerRoleHint: 'retailer'
  });

  assert.equal(chainRouting.buyerRole, 'retailer');
  assert.equal(allowedRolesSet.has('dealer'), true);
  assert.equal(allowedRolesSet.has('local_distributor'), false);
});

test('buildAllowedUpstreamRolesSet: retailer on manufacturer-only admin chain resolves manufacturer, never dealer', () => {
  const chainRow = {
    category_name: 'nyka',
    stages: [{ role: 'manufacturer' }, { role: 'retailer' }]
  };
  const profile = {
    companyInfoEntries: [{ role: 'retailer', brands: 'nyka' }]
  };
  const parentRolesUnion = new Set(['dealer']);

  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey: 'nyka',
    chainRow,
    parentRolesUnion,
    buyerRoleHint: 'retailer'
  });

  assert.equal(chainRouting.requiredUpstreamRole, 'manufacturer');
  assert.equal(allowedRolesSet.size, 1);
  assert.equal(allowedRolesSet.has('manufacturer'), true);
  assert.equal(allowedRolesSet.has('dealer'), false);
});

test('buildAllowedUpstreamRolesSet: only immediate upstream tier is allowed when admin chain exists', () => {
  const chainRow = {
    category_name: 'apple',
    stages: [
      { role: 'manufacturer' },
      { role: 'regional_distributor' },
      { role: 'local_distributor' },
      { role: 'retailer' }
    ]
  };
  const profile = {
    companyInfoEntries: [{ role: 'retailer', brands: 'apple' }]
  };
  const parentRolesUnion = new Set(['dealer']);

  const { allowedRolesSet, chainRouting } = buildAllowedUpstreamRolesSet({
    profile,
    brandKey: 'apple',
    chainRow,
    parentRolesUnion,
    buyerRoleHint: 'retailer'
  });

  assert.equal(chainRouting.requiredUpstreamRole, 'local_distributor');
  assert.equal(allowedRolesSet.size, 1);
  assert.equal(allowedRolesSet.has('local_distributor'), true);
  assert.equal(allowedRolesSet.has('regional_distributor'), false);
  assert.equal(allowedRolesSet.has('manufacturer'), false);
  assert.equal(allowedRolesSet.has('dealer'), false);
});

test('sellerHasRoleForBrand: legacy supplierRole with companyInfoEntries uses role entry brands', () => {
  const profile = {
    supplierRole: 'local_distributor',
    brands: 'other',
    companyInfoEntries: [{ role: 'local_distributor', brands: 'apple' }]
  };
  assert.equal(sellerHasRoleForBrand(profile, 'local_distributor', 'apple'), true);
  assert.equal(sellerHasRoleForBrand(profile, 'local_distributor', 'other'), false);
});

test('pickAnyUpstreamSellerRoleOnChain: matches regional distributor on apple admin chain', () => {
  const chainRow = {
    category_name: 'apple',
    stages: [
      { role: 'manufacturer' },
      { role: 'regional_distributor' },
      { role: 'local_distributor' },
      { role: 'retailer' }
    ]
  };
  const sellerProfile = {
    companyInfoEntries: [{ role: 'regional_distributor', brands: 'apple' }]
  };
  assert.equal(
    pickAnyUpstreamSellerRoleOnChain(sellerProfile, 'retailer', 'apple', chainRow),
    'regional_distributor'
  );
});
