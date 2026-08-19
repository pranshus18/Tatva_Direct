import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandIsAllowedForSupplier,
  entryOverlapsViewerBrands,
  getViewerBrandTokensForRole,
  resolveSupplierProductBrandGuard
} from '../services/supplierBrandGuardService.js';
import { buildEffectiveSupplierChainProfile } from '../services/supplierChainProfileService.js';
import { mapSupplyChainPartner } from '../services/supplierPartnerMapperService.js';

test('entryOverlapsViewerBrands: partner with no brands still matches viewer brands', () => {
  const viewer = new Set(['cement']);
  assert.equal(entryOverlapsViewerBrands({ brands: '' }, viewer), true);
});

test('entryOverlapsViewerBrands: fuzzy match on normalized brand keys', () => {
  const viewer = new Set(['asian paints']);
  assert.equal(entryOverlapsViewerBrands({ brands: 'Asian-Paints' }, viewer), true);
});

test('getViewerBrandTokensForRole: inherits profile-level brands when role entry brands empty', () => {
  const profile = {
    supplierRole: 'retailer',
    brands: 'Oil, Cement',
    companyInfoEntries: [{ role: 'retailer', brands: '' }]
  };
  const tokens = getViewerBrandTokensForRole(profile, 'retailer');
  assert.ok(tokens.has('oil'));
  assert.ok(tokens.has('cement'));
});

test('mapSupplyChainPartner: profile listing skips brand filter when filterByBrand is false', () => {
  const partner = mapSupplyChainPartner(
    {
      id: 'dealer-1',
      name: 'Dealer Co',
      company: 'Dealer Co',
      phone: '',
      email: 'd@example.com',
      address: {},
      profile: {
        companyInfoEntries: [{ id: '1', role: 'dealer', brands: 'Other Brand' }]
      }
    },
    'dealer',
    new Set(['my brand']),
    { filterByBrand: false }
  );
  assert.ok(partner);
  assert.equal(partner.supplierRole, 'dealer');
});

test('buildEffectiveSupplierChainProfile: unions draft and pending brands for product access', () => {
  const profile = {
    supplierRole: 'dealer',
    brands: 'Phillips',
    companyInfoEntries: [{ id: 'saved-1', role: 'dealer', brands: 'Phillips' }],
    chainProfileDraft: {
      companyInfoEntries: [{ id: 'draft-1', role: '', brands: 'Finolex' }]
    }
  };
  const pendingPayload = {
    companyInfoEntries: [{ id: 'pending-1', role: 'retailer', brands: 'acc' }]
  };

  const effective = buildEffectiveSupplierChainProfile(profile, pendingPayload);
  const declared = [...effective.companyInfoEntries.map((e) => e.brands)].sort();

  assert.deepEqual(declared.sort(), ['Phillips', 'acc', 'Finolex'].sort());
  assert.equal(brandIsAllowedForSupplier(effective, 'acc').allowed, true);
  assert.equal(brandIsAllowedForSupplier(effective, 'Finolex').allowed, true);
});

test('resolveSupplierProductBrandGuard: allows selected profile brand when catalog brand differs', () => {
  const profile = {
    companyInfoEntries: [{ id: '1', role: 'dealer', brands: 'Phillips' }]
  };
  const result = resolveSupplierProductBrandGuard(profile, {
    selectedBrand: 'Phillips',
    catalogBrand: 'Philips Lighting'
  });
  assert.equal(result.allowed, true);
  assert.equal(result.brand, 'Phillips');
});

test('resolveSupplierProductBrandGuard: spelling variants are not the same declared brand', () => {
  const profile = {
    companyInfoEntries: [{ id: '1', role: 'dealer', brands: 'Phillips' }]
  };
  const result = resolveSupplierProductBrandGuard(profile, {
    selectedBrand: 'Philips',
    catalogBrand: ''
  });
  assert.equal(result.allowed, false);
});

test('brandIsAllowedForSupplier: partial prefix H must not match registered HP', () => {
  const profile = {
    companyInfoEntries: [{ id: '1', role: 'dealer', brands: 'HP' }]
  };
  assert.equal(brandIsAllowedForSupplier(profile, 'H').allowed, false);
  assert.equal(brandIsAllowedForSupplier(profile, 'HP').allowed, true);
  assert.equal(brandIsAllowedForSupplier(profile, 'Haier').allowed, false);
});

test('brandIsAllowedForSupplier: multi-word brand still matches longer product brand label', () => {
  const profile = {
    companyInfoEntries: [{ id: '1', role: 'retailer', brands: 'Havells' }]
  };
  assert.equal(brandIsAllowedForSupplier(profile, 'Havells Electrical').allowed, true);
});
