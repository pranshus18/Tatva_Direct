import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveSupplierOfferState } from '../controllers/supplier/shared/productHelpers.js';

test('approved catalog + approved offer stays approved/active for supplier catalog', () => {
  const state = resolveEffectiveSupplierOfferState(
    { status: 'approved', is_active: true, stock: 0 },
    { status: 'approved' }
  );
  assert.equal(state.effectiveStatus, 'approved');
  assert.equal(state.effectiveActive, true);
  assert.equal(state.needsCatalogSync, false);
});

test('approved catalog + pending offer stays pending until that offer is approved', () => {
  const state = resolveEffectiveSupplierOfferState(
    { status: 'pending', is_active: false, stock: 0 },
    { status: 'approved' }
  );
  assert.equal(state.effectiveStatus, 'pending');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.needsCatalogSync, false);
});
