import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryOverlapsViewerBrands,
  getViewerBrandTokensForRole
} from '../services/supplierBrandGuardService.js';
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
