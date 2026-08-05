import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupplierProductUpdatePayload } from '../services/supplierProductWriteService.js';
import { bodyHasInventoryUpdateFields } from '../services/supplierProductUpdateValidation.js';

const noopDeps = {
  validateAndNormalizeTaxRates: () => ({ ok: true, data: {} }),
  sanitizeImageUrls: (urls) => urls,
  normalizeGtin: (value) => value,
  isValidGtin: () => true,
  shouldMoveToPendingForSpecChange: () => false
};

test('bodyHasInventoryUpdateFields treats lsa as inventory', () => {
  assert.equal(bodyHasInventoryUpdateFields({ lsa: '5' }), true);
  assert.equal(bodyHasInventoryUpdateFields({ name: 'Widget' }), false);
});

test('buildSupplierProductUpdatePayload persists lsa on offer attributes', () => {
  const payload = buildSupplierProductUpdatePayload({
    reqBody: { lsa: '12' },
    supplierProduct: {
      price: 140,
      stock: 10,
      location: 'Pune',
      min_order_quantity: 1,
      attributes: { lsa: '1', brand: 'Milton' }
    },
    ...noopDeps
  });

  assert.equal(payload.updatedAttributes.lsa, '12');
  assert.equal(payload.updateSupplierProductData.attributes.lsa, '12');
});
