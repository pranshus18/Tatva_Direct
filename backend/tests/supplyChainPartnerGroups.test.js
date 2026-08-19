import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoUpstreamOffersMessage,
  buildSupplyChainPartnerGroups,
  buildUpstreamChainContextForMineOffer,
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

test('buildUpstreamChainContextForMineOffer: retailer on dealer-less apple chain resolves local distributor', () => {
  const profile = {
    companyInfoEntries: [{ role: 'retailer', brands: 'apple' }]
  };
  const chainRow = {
    category_name: 'Apple Inc',
    stages: [
      { role: 'manufacturer' },
      { role: 'local_distributor' },
      { role: 'retailer' }
    ]
  };
  const adminBrandChainMap = new Map([['apple', chainRow]]);

  const ctx = buildUpstreamChainContextForMineOffer({
    profile,
    mineOffer: {
      attributes: { brandModel: 'apple' },
      product: { brand: 'apple' }
    },
    adminBrandChainMap,
    parentRolesUnion: new Set(['dealer'])
  });

  assert.equal(ctx.requiredUpstreamRole, 'local_distributor');
  assert.equal(ctx.requiredUpstreamRoleLabel, 'Local distributors');
  assert.equal(ctx.chainRouting.requiredUpstreamRole, 'local_distributor');
});

test('buildUpstreamChainContextForMineOffer: retailer on manufacturer-retailer chain resolves manufacturer', () => {
  const profile = {
    companyInfoEntries: [{ role: 'retailer', brands: 'nyka' }]
  };
  const chainRow = {
    category_name: 'Nykaa',
    stages: [{ role: 'manufacturer' }, { role: 'retailer' }]
  };
  const adminBrandChainMap = new Map([['nyka', chainRow]]);

  const ctx = buildUpstreamChainContextForMineOffer({
    profile,
    mineOffer: {
      attributes: { brand: 'nyka' },
      product: { brand: 'nyka' }
    },
    adminBrandChainMap,
    parentRolesUnion: new Set(['dealer'])
  });

  assert.equal(ctx.requiredUpstreamRole, 'manufacturer');
  assert.equal(ctx.requiredUpstreamRoleLabel, 'Manufacturers (MGF)');
  assert.equal(ctx.chainRouting.requiredUpstreamRole, 'manufacturer');
});

test('buildNoUpstreamOffersMessage: names manufacturer when that is the only upstream layer on admin chain', () => {
  const message = buildNoUpstreamOffersMessage({
    brandLabel: 'nyka',
    requiredUpstreamRoleLabel: 'Manufacturers (MGF)',
    chainRouting: {
      requiredUpstreamRole: 'manufacturer',
      chainRoles: ['manufacturer', 'retailer']
    }
  });

  assert.match(message, /cannot be sourced from Manufacturers \(MGF\) for "nyka"/);
  assert.match(message, /No Manufacturers \(MGF\) currently list this product with stock/);
  assert.doesNotMatch(message, /Dealers/);
  assert.doesNotMatch(message, /dealer/i);
});

test('buildNoUpstreamOffersMessage: missing listings and wrong layer share a headline and distinguish the reason', () => {
  const noListings = buildNoUpstreamOffersMessage({
    brandLabel: 'Prestige',
    requiredUpstreamRoleLabel: 'Regional distributors',
    reason: 'no_listings'
  });
  const wrongLayer = buildNoUpstreamOffersMessage({
    brandLabel: 'Fastrack',
    requiredUpstreamRoleLabel: 'Manufacturers (MGF)',
    reason: 'wrong_layer'
  });

  assert.match(noListings, /^This product cannot be sourced from Regional distributors for "Prestige"\./);
  assert.match(wrongLayer, /^This product cannot be sourced from Manufacturers \(MGF\) for "Fastrack"\./);
  assert.match(noListings, /No Regional distributors currently list this product with stock/);
  assert.match(wrongLayer, /Other suppliers list this product with stock, but none are Manufacturers \(MGF\)/);
  assert.doesNotMatch(noListings, /Other suppliers list this product/);
  assert.doesNotMatch(wrongLayer, /currently list this product with stock/);
});
