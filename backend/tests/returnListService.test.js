import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBuyerOutgoingReturnScope,
  classifySupplierIncomingReturnScope
} from '../services/returnListService.js';

test('classifySupplierIncomingReturnScope splits customer vs chain', () => {
  assert.equal(
    classifySupplierIncomingReturnScope({ orderChannel: 'online_sale', buyerUserType: 'service_provider' }),
    'customer'
  );
  assert.equal(
    classifySupplierIncomingReturnScope({ orderChannel: 'b2b_po', buyerUserType: 'supplier' }),
    'chain'
  );
});

test('classifyBuyerOutgoingReturnScope splits retail vs upstream', () => {
  assert.equal(
    classifyBuyerOutgoingReturnScope({ orderChannel: 'online_sale', buyerUserType: 'service_provider' }),
    'retail'
  );
  assert.equal(
    classifyBuyerOutgoingReturnScope({ orderChannel: 'b2b_po', buyerUserType: 'supplier' }),
    'upstream'
  );
});
