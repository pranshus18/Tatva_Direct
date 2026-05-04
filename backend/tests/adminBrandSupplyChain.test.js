import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllowedSellerRoleForBrand,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';

function buildRoleMap(entries) {
  return new Map(entries);
}

test('supplierMatchesBrandTerminalRole: matches only when role+brand entry aligns', () => {
  const terminalRoleByBrandMap = buildRoleMap([
    ['asian paints', 'dealer']
  ]);

  const supplierProfile = {
    supplierRole: 'retailer',
    companyInfoEntries: [
      { role: 'retailer', brands: 'berger' },
      { role: 'dealer', brands: 'asian paints, nippon' }
    ]
  };

  const allowed = supplierMatchesBrandTerminalRole(
    supplierProfile,
    'Asian Paints',
    terminalRoleByBrandMap
  );

  assert.equal(allowed, true);
});

test('supplierMatchesBrandTerminalRole: rejects same role for other brand only', () => {
  const terminalRoleByBrandMap = buildRoleMap([
    ['asian paints', 'dealer']
  ]);

  const supplierProfile = {
    supplierRole: 'dealer',
    companyInfoEntries: [
      { role: 'dealer', brands: 'berger' },
      { role: 'retailer', brands: 'asian paints' }
    ]
  };

  const allowed = supplierMatchesBrandTerminalRole(
    supplierProfile,
    'Asian Paints',
    terminalRoleByBrandMap
  );

  assert.equal(allowed, false);
});

test('supplierMatchesBrandTerminalRole: allows when admin brand chain is missing', () => {
  const terminalRoleByBrandMap = buildRoleMap([
    ['asian paints', 'dealer']
  ]);

  const supplierProfile = {
    supplierRole: 'retailer',
    companyInfoEntries: [{ role: 'retailer', brands: 'berger' }]
  };

  const allowed = supplierMatchesBrandTerminalRole(
    supplierProfile,
    'Unknown Brand',
    terminalRoleByBrandMap
  );

  assert.equal(allowed, true);
});

test('getAllowedSellerRoleForBrand: normalizes case and punctuation', () => {
  const terminalRoleByBrandMap = buildRoleMap([
    ['asian paints', 'dealer']
  ]);

  const role = getAllowedSellerRoleForBrand('  ASIAN Paints!!! ', terminalRoleByBrandMap);
  assert.equal(role, 'dealer');
});
