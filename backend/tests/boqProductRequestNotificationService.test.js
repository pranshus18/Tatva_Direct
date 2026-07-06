import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSuppliersAtTerminalRole,
  resolveBrandAndTerminalRoleForProductRequest
} from '../services/boqProductRequestNotificationService.js';

const chainRows = [
  {
    category_name: 'Asian Paints',
    stages: [
      { role: 'manufacturer' },
      { role: 'stockist' },
      { role: 'dealer' }
    ],
    updated_at: '2026-01-01T00:00:00.000Z'
  },
  {
    category_name: 'Apple',
    stages: [{ role: 'manufacturer' }, { role: 'retailer' }],
    updated_at: '2026-01-01T00:00:00.000Z'
  }
];

const mockDb = {
  from: () => ({
    select: async () => ({ data: chainRows, error: null })
  })
};

test('filterSuppliersAtTerminalRole matches only the configured terminal role for a brand', () => {
  const suppliers = [
    {
      id: '1',
      profile: {
        companyInfoEntries: [{ role: 'dealer', brands: 'Asian Paints' }]
      }
    },
    {
      id: '2',
      profile: {
        companyInfoEntries: [{ role: 'retailer', brands: 'Asian Paints' }]
      }
    },
    {
      id: '3',
      profile: {
        companyInfoEntries: [{ role: 'dealer', brands: 'Apple' }]
      }
    }
  ];

  const matched = filterSuppliersAtTerminalRole(suppliers, 'Asian Paints', 'dealer');
  assert.deepEqual(matched.map((s) => s.id), ['1']);
});

test('filterSuppliersAtTerminalRole returns empty list when terminal role is unknown', () => {
  const suppliers = [
    {
      id: '1',
      profile: {
        supplierRole: 'retailer'
      }
    }
  ];

  assert.deepEqual(filterSuppliersAtTerminalRole(suppliers, 'Unknown Brand', null), []);
});

test('resolveBrandAndTerminalRoleForProductRequest uses the last configured supply-chain role', async () => {
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(
    mockDb,
    'asian paints premium',
    'Asian Paints'
  );

  assert.equal(resolved.brandName, 'Asian Paints');
  assert.equal(resolved.terminalRole, 'dealer');
});

test('resolveBrandAndTerminalRoleForProductRequest can resolve retailer when that is the last role', async () => {
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(
    mockDb,
    'mac air m2',
    'Apple'
  );

  assert.equal(resolved.brandName, 'Apple');
  assert.equal(resolved.terminalRole, 'retailer');
});

test('resolveBrandAndTerminalRoleForProductRequest returns null role when no chain is configured', async () => {
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(
    mockDb,
    'unknown widget',
    'Unknown Brand'
  );

  assert.equal(resolved.brandName, 'Unknown Brand');
  assert.equal(resolved.terminalRole, null);
});
