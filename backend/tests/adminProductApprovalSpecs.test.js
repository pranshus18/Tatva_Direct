import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeVariantSpecificationTemplate,
  parseSpecificationsObject,
  specificationTemplateKeysOnly
} from '../services/supplierCatalogHelpersService.js';
import { areSupplierOfferSpecificationValuesLocked } from '../services/supplierProductUpdateValidation.js';

function mergeSpecsOnApproval(catalogSpecifications, existingOfferSpecifications) {
  const adminSpecKeys = specificationTemplateKeysOnly(
    parseSpecificationsObject(catalogSpecifications) || {}
  );
  const existingOfferSpecs = parseSpecificationsObject(existingOfferSpecifications) || {};
  return mergeVariantSpecificationTemplate(adminSpecKeys, existingOfferSpecs);
}

test('approval spec sync does not copy filled catalog defaults onto empty variant offers', () => {
  const merged = mergeSpecsOnApproval(
    {
      Color: 'Silver',
      Capacity: '1 L'
    },
    {
      Color: '',
      Capacity: ''
    }
  );

  assert.equal(merged.Color, '');
  assert.equal(merged.Capacity, '');
});

test('approval spec sync preserves supplier-filled values for admin template keys', () => {
  const merged = mergeSpecsOnApproval(
    {
      Brand: '',
      'Model Name': '',
      Capacity: ''
    },
    {
      Brand: 'Milton',
      'Model Name': '600 ml',
      Capacity: '750 ml'
    }
  );

  assert.equal(merged.Brand, 'Milton');
  assert.equal(merged['Model Name'], '600 ml');
  assert.equal(merged.Capacity, '750 ml');
  assert.equal(
    areSupplierOfferSpecificationValuesLocked(
      {
        status: 'approved',
        attributes: { specifications: merged }
      },
      ['Brand', 'Model Name', 'Capacity']
    ),
    true
  );
});

test('approval spec sync still requires fill when supplier values are incomplete', () => {
  const merged = mergeSpecsOnApproval(
    {
      Brand: '',
      'Model Name': ''
    },
    {
      Brand: 'Milton',
      'Model Name': ''
    }
  );

  assert.equal(merged.Brand, 'Milton');
  assert.equal(merged['Model Name'], '');
  assert.equal(
    areSupplierOfferSpecificationValuesLocked(
      {
        status: 'approved',
        attributes: { specifications: merged }
      },
      ['Brand', 'Model Name']
    ),
    false
  );
});
