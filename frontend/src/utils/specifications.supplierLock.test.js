import { describe, expect, it } from 'vitest';
import {
  hasMeaningfulSpecValues,
  supplierOfferNeedsPostApprovalSpecFill,
  supplierSpecificationValuesLocked
} from './specifications.js';

describe('supplier specification value locking', () => {
  it('allows fill when pending product has admin keys but no values yet', () => {
    expect(
      supplierSpecificationValuesLocked({
        specifications: { Brand: '', 'Model Name': null },
        productStatus: 'pending'
      })
    ).toBe(false);
  });

  it('allows partial post-approval fill until every admin key is saved on the offer', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { Brand: 'Milton', 'Model Name': '' },
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        productStatus: 'approved'
      })
    ).toBe(false);
    expect(
      supplierOfferNeedsPostApprovalSpecFill({
        status: 'approved',
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        supplierOfferSpecifications: { Brand: 'Milton', 'Model Name': '' }
      })
    ).toBe(true);
  });

  it('locks after every admin key has a supplier offer value', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { Brand: 'Milton', 'Model Name': '600 ml' },
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        productStatus: 'approved'
      })
    ).toBe(true);
    expect(hasMeaningfulSpecValues({ Brand: 'Milton' })).toBe(true);
  });

  it('does not lock approved offers until supplier values are saved', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { Brand: '', 'Model Name': '' },
        supplierSpecValuesLocked: false,
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        productStatus: 'approved'
      })
    ).toBe(false);
    expect(
      supplierSpecificationValuesLocked({
        supplierSpecValuesLocked: true
      })
    ).toBe(true);
  });

  it('matches template keys with offer keys using punctuation-insensitive comparison', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { brand: 'Milton', modelname: '600 ml' },
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        productStatus: 'approved'
      })
    ).toBe(true);
  });

  it('does not ask for post-approval fill when every admin key was already saved', () => {
    expect(
      supplierOfferNeedsPostApprovalSpecFill({
        status: 'approved',
        catalogSpecificationKeys: ['Brand', 'Model Name'],
        supplierOfferSpecifications: { Brand: 'Milton', 'Model Name': '600 ml' }
      })
    ).toBe(false);
  });
});
