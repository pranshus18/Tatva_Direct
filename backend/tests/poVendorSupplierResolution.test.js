import test from 'node:test';
import assert from 'node:assert/strict';
import { isPoVendorSupplierUser } from '../controllers/po/shared/poHelpers.js';

test('dual-role vendor stays eligible when active portal is service_provider', () => {
  const vendor = {
    id: '54e4ec86-5de6-44fa-b8a8-2468e3af9df4',
    user_type: 'service_provider',
    profile: {
      registeredRoles: ['service_provider', 'supplier'],
      pmVendorLead: { id: 'lead-1' },
      supplierProfileIncomplete: false
    }
  };
  assert.equal(isPoVendorSupplierUser(vendor), true);
});

test('service_provider without supplier registration is not a PO vendor', () => {
  const vendor = {
    id: 'be8de1b1-e27a-48c4-9113-10c51d6d1e0c',
    user_type: 'service_provider',
    profile: { registeredRoles: ['service_provider'] }
  };
  assert.equal(isPoVendorSupplierUser(vendor), false);
});
