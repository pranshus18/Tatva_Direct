import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupplierOfferAvailableForUpstream,
  resolveEffectiveSupplierOfferState
} from '../controllers/supplier/shared/productHelpers.js';

test('resolveEffectiveSupplierOfferState: pending junction + approved catalog shows active', () => {
  const row = {
    id: 'offer-1',
    status: 'pending',
    is_active: false,
    stock: 105,
    product: { status: 'approved' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'approved');
  assert.equal(state.effectiveActive, true);
  assert.equal(state.availableForUpstream, true);
  assert.equal(state.needsCatalogSync, true);
  assert.equal(isSupplierOfferAvailableForUpstream(row), true);
});

test('resolveEffectiveSupplierOfferState: pending without approved catalog stays inactive', () => {
  const row = {
    status: 'pending',
    is_active: false,
    stock: 10,
    product: { status: 'pending' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'pending');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.availableForUpstream, false);
});

test('resolveEffectiveSupplierOfferState: rejected offer stays rejected', () => {
  const row = {
    status: 'rejected',
    is_active: false,
    stock: 10,
    product: { status: 'approved' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'rejected');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.availableForUpstream, false);
});

test('resolveEffectiveSupplierOfferState: rejected catalog marks offer rejected', () => {
  const row = {
    status: 'pending',
    is_active: false,
    stock: 10,
    product: { status: 'rejected' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'rejected');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.availableForUpstream, false);
});
