import { describe, expect, it } from 'vitest';
import {
  resolveAdminDisplaySpecifications,
  getAdminPolishSourceText
} from './adminProductDisplay.js';

describe('resolveAdminDisplaySpecifications', () => {
  it('merges catalog template keys with supplier offer values', () => {
    const specs = resolveAdminDisplaySpecifications({
      catalogSpecifications: { COLOR: 'Red', CAPACITY: '600 ml' },
      supplierOfferSpecifications: { COLOR: 'Blue', CAPACITY: '' }
    });
    expect(specs.COLOR).toBe('Blue');
    expect(specs.CAPACITY).toBe('');
  });

  it('falls back to parsed specifications when no split fields exist', () => {
    const specs = resolveAdminDisplaySpecifications({
      specifications: { height: '8 inch', color: 'white' }
    });
    expect(specs.height).toBe('8 inch');
    expect(specs.color).toBe('white');
  });
});

describe('getAdminPolishSourceText', () => {
  const product = {
    description: 'Published buyer copy.',
    publishedDescription: 'Published buyer copy.',
    supplierDescription: 'Raw supplier draft.'
  };

  it('prefers in-progress admin edit text when editing', () => {
    expect(
      getAdminPolishSourceText({
        product,
        editedProduct: { description: 'Draft in edit box' },
        isEditing: true
      })
    ).toBe('Draft in edit box');
  });

  it('falls back to supplier draft when edit box is empty', () => {
    expect(
      getAdminPolishSourceText({
        product,
        editedProduct: { description: '' },
        isEditing: true
      })
    ).toBe('Raw supplier draft.');
  });

  it('uses buyer-facing catalog copy when not editing and no supplier draft', () => {
    expect(
      getAdminPolishSourceText({
        product: { status: 'approved', description: 'Catalog copy only.' },
        editedProduct: {},
        isEditing: false
      })
    ).toBe('Catalog copy only.');
  });
});
