import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupplierOfferAvailableForUpstream,
  isSupplierOfferEligibleForUpstreamSelection,
  resolveEffectiveSupplierOfferState
} from '../controllers/supplier/shared/productHelpers.js';

test('resolveEffectiveSupplierOfferState: approved offer stays approved/active', () => {
  const row = {
    id: 'offer-1',
    status: 'approved',
    is_active: true,
    stock: 105,
    product: { status: 'approved' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'approved');
  assert.equal(state.effectiveActive, true);
  assert.equal(state.availableForUpstream, true);
  assert.equal(state.needsCatalogSync, false);
  assert.equal(isSupplierOfferAvailableForUpstream(row), true);
});

test('resolveEffectiveSupplierOfferState: pending offer stays pending even when catalog is approved', () => {
  const row = {
    status: 'pending',
    is_active: false,
    stock: 10,
    product: { status: 'approved' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'pending');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.availableForUpstream, false);
  assert.equal(state.needsCatalogSync, false);
});

test('resolveEffectiveSupplierOfferState: pending + is_active true still shows pending', () => {
  // Catalog rows default is_active=true; that must not imply admin approval.
  const row = {
    status: 'pending',
    is_active: true,
    stock: 10,
    product: { status: 'pending', is_active: true }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'pending');
  assert.equal(state.effectiveActive, false);
  assert.equal(state.needsCatalogSync, false);
});

test('resolveEffectiveSupplierOfferState: approved offer with stale inactive flag needs heal', () => {
  const row = {
    status: 'approved',
    is_active: false,
    stock: 10,
    product: { status: 'approved' }
  };
  const state = resolveEffectiveSupplierOfferState(row);
  assert.equal(state.effectiveStatus, 'approved');
  assert.equal(state.effectiveActive, true);
  assert.equal(state.needsCatalogSync, true);
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

test('isSupplierOfferEligibleForUpstreamSelection: approved active offers only', () => {
  assert.equal(
    isSupplierOfferEligibleForUpstreamSelection({
      status: 'approved',
      is_active: true,
      stock: 0,
      product: { status: 'approved' }
    }),
    true
  );
  assert.equal(
    isSupplierOfferEligibleForUpstreamSelection({
      status: 'rejected',
      is_active: false,
      stock: 10,
      product: { status: 'approved' }
    }),
    false
  );
  assert.equal(
    isSupplierOfferEligibleForUpstreamSelection({
      status: 'pending',
      is_active: false,
      stock: 10,
      product: { status: 'approved' }
    }),
    false
  );
});
