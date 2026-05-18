import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasMandatoryTransportSelected,
  isTransportRetryPhrase,
  vendorsMissingTransport
} from '../voice/lib/transportGate.js';

test('hasMandatoryTransportSelected requires every quoted vendor to have a courier', () => {
  const checkout = {
    optionsByVendor: {
      v1: { providers: [{ name: 'Delhivery' }] },
      v2: { providers: [{ name: 'BlueDart' }] }
    },
    transportByVendor: { v1: 'Delhivery' }
  };
  assert.equal(hasMandatoryTransportSelected(checkout), false);
  assert.equal(vendorsMissingTransport(checkout).length, 1);

  checkout.transportByVendor.v2 = 'BlueDart';
  assert.equal(hasMandatoryTransportSelected(checkout), true);
});

test('hasMandatoryTransportSelected is false when no courier quotes exist', () => {
  assert.equal(
    hasMandatoryTransportSelected({
      optionsByVendor: { v1: { providers: [] } },
      transportByVendor: {}
    }),
    false
  );
});

test('isTransportRetryPhrase recognizes reload commands', () => {
  assert.equal(isTransportRetryPhrase('please retry'), true);
  assert.equal(isTransportRetryPhrase('track order PO-1'), false);
});
