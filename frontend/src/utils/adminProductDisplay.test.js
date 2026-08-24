import { describe, expect, it } from 'vitest';
import {
  resolveAdminDisplaySpecifications,
  getAdminPolishSourceText,
  getAdminRowDisplayName
} from './adminProductDisplay.js';

describe('resolveAdminDisplaySpecifications', () => {
  it('uses supplier offer specs only and ignores catalog values', () => {
    const specs = resolveAdminDisplaySpecifications({
      catalogSpecifications: { COLOR: 'Red', HEEL: '2 cm' },
      supplierOfferSpecifications: { COLOR: 'Blue', CAPACITY: '600 ml' }
    });
    expect(specs.COLOR).toBe('Blue');
    expect(specs.CAPACITY).toBe('600 ml');
    expect(specs.HEEL).toBeUndefined();
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

describe('getAdminRowDisplayName', () => {
  it('prefers the supplier listing name over a mis-linked catalog title', () => {
    expect(
      getAdminRowDisplayName({
        name: 'Milton Thermosteel Flask',
        catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.',
        variantLabel: 'Color: Silver · Material: Stainless Steel · Height: 28 cm'
      })
    ).toBe(
      'Milton Thermosteel Flask — Color: Silver · Material: Stainless Steel · Height: 28 cm'
    );
  });

  it('does not fall back to catalogName when the offer already has a title', () => {
    expect(
      getAdminRowDisplayName({
        name: 'Milton Thermosteel Flask',
        catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.'
      })
    ).toBe('Milton Thermosteel Flask');
  });
});
