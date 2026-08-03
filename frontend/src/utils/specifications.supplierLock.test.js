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

  it('locks after meaningful values were saved', () => {
    expect(
      supplierSpecificationValuesLocked({
        specifications: { Brand: 'Milton', 'Model Name': '' },
        status: 'pending'
      })
    ).toBe(true);
    expect(hasMeaningfulSpecValues({ Brand: 'Milton' })).toBe(true);
  });

  it('locks approved offers regardless of spec values', () => {
    expect(
      supplierSpecificationValuesLocked({
        specifications: {},
        status: 'approved'
      })
    ).toBe(true);
  });
});
