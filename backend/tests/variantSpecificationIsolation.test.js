import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogSpecificationTemplateForVariantMerge,
  mergeOfferSpecifications,
  resolveCatalogBaselineSpecifications
} from '../services/supplierCatalogHelpersService.js';

test('catalogSpecificationTemplateForVariantMerge keeps keys but clears filled values', () => {
  const template = catalogSpecificationTemplateForVariantMerge({
    Color: 'Silver',
    Capacity: '1 L',
    Height: '8 inch'
  });
  assert.deepEqual(template, { Color: '', Capacity: '', Height: '' });
});

test('mergeOfferSpecifications keeps variant A and variant B specs independent on shared catalog', () => {
  const sharedCatalog = {
    Color: 'Silver',
    Capacity: '1 L',
    'BPA Free': 'Yes'
  };

  const variantA = mergeOfferSpecifications(sharedCatalog, {
    attributes: { specifications: { Color: 'black', Capacity: '500ML' } }
  });
  const variantB = mergeOfferSpecifications(sharedCatalog, {
    attributes: { specifications: { Color: 'silver', Capacity: '600 ml' } }
  });

  assert.equal(variantA.Color, 'black');
  assert.equal(variantA.Capacity, '500ML');
  assert.equal(variantB.Color, 'silver');
  assert.equal(variantB.Capacity, '600 ml');
});

test('resolveCatalogBaselineSpecifications uses catalog filled values when no same-variant offer exists', async () => {
  const supabase = {
    from(table) {
      if (table !== 'supplier_products') throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: [
                              {
                                id: 'offer-other',
                                variant_key: 'other-variant',
                                status: 'approved',
                                attributes: {
                                  specifications: { Color: 'black', Capacity: '500ML' }
                                }
                              }
                            ],
                            error: null
                          });
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const baseline = await resolveCatalogBaselineSpecifications(supabase, {
    productId: 'prod-shared',
    catalogSpecs: { Color: 'Silver', Capacity: '1 L' },
    variantKey: 'new-silver-listing'
  });

  // Other variants must not be used; catalog filled values remain the create-time baseline.
  assert.equal(baseline.Color, 'Silver');
  assert.equal(baseline.Capacity, '1 L');
});

test('resolveCatalogBaselineSpecifications ignores other variants when variantKey is scoped', async () => {
  const supabase = {
    from(table) {
      if (table !== 'supplier_products') throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return {
            eq(_col, productId) {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: [
                              {
                                id: 'offer-rich-other',
                                variant_key: 'other-variant',
                                variant_asin: 'TS1B2D',
                                status: 'approved',
                                attributes: {
                                  specifications: { Color: 'silver', Capacity: '1 L' }
                                }
                              },
                              {
                                id: 'offer-target',
                                variant_key: 'black-500',
                                variant_asin: 'TS1B1D',
                                status: 'approved',
                                attributes: {
                                  specifications: { Color: 'black', Capacity: '500ML' }
                                }
                              }
                            ],
                            error: null
                          });
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const productId = 'prod-shared';
  const baseline = await resolveCatalogBaselineSpecifications(supabase, {
    productId,
    catalogSpecs: { Color: 'Silver', Capacity: '1 L' },
    variantKey: 'black-500'
  });

  assert.equal(baseline.Color, 'black');
  assert.equal(baseline.Capacity, '500ML');
});
