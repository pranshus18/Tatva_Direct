import { describe, expect, it } from 'vitest';
import {
  hasMeaningfulSpecValues,
  supplierSpecificationValuesLocked
} from './specifications.js';

describe('supplier specification value locking', () => {
  it('allows fill when pending product has admin keys but no values yet', () => {
    expect(
      supplierSpecificationValuesLocked({
        specifications: { Brand: '', 'Model Name': null },
        status: 'pending'
      })
    ).toBe(false);
  });

  it('locks after meaningful values were saved on the offer', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { Brand: 'Milton', 'Model Name': '' }
      })
    ).toBe(true);
    expect(hasMeaningfulSpecValues({ Brand: 'Milton' })).toBe(true);
  });

  it('does not lock approved offers until supplier values are saved', () => {
    expect(
      supplierSpecificationValuesLocked({
        offerSpecifications: { Brand: '', 'Model Name': '' },
        supplierSpecValuesLocked: false
      })
    ).toBe(false);
    expect(
      supplierSpecificationValuesLocked({
        supplierSpecValuesLocked: true
      })
    ).toBe(true);
  });
});
