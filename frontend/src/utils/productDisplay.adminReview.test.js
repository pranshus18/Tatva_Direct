import { describe, expect, it } from 'vitest';
import {
  getAdminBuyerFacingCatalogDescription,
  getAdminReviewProductDescription,
  getAdminSupplierSubmittedDescription,
  looksLikeSpecificationDump
} from './productDisplay.js';

describe('admin product descriptions', () => {
  it('shows supplier draft on list cards while pending', () => {
    const product = {
      status: 'pending',
      description: 'Previously polished buyer-facing copy.',
      supplierDescription: 'Specification Value Air Conditioner Type Split Inverter AC'
    };
    expect(getAdminReviewProductDescription(product)).toBe(
      'Specification Value Air Conditioner Type Split Inverter AC'
    );
  });

  it('keeps buyer-facing edit box empty for pending until admin saves published copy', () => {
    const product = {
      status: 'pending',
      description: 'Previously polished buyer-facing copy.',
      supplierDescription: 'Specification Value Air Conditioner Type Split Inverter AC'
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe('');
  });

  it('shows admin-saved buyer-facing copy for pending once publishedDescription exists', () => {
    const product = {
      status: 'pending',
      description: 'Polished buyer-facing copy saved by admin.',
      publishedDescription: 'Polished buyer-facing copy saved by admin.',
      supplierDescription: 'Raw supplier submission.'
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe(
      'Polished buyer-facing copy saved by admin.'
    );
  });

  it('accepts admin-saved supplier text without AI polish when publishedDescription is set', () => {
    const supplierText = 'This steel bottle keeps drinks hot and cold for hours.';
    const product = {
      status: 'pending',
      description: supplierText,
      publishedDescription: supplierText,
      supplierDescription: supplierText
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe(supplierText);
  });

  it('shows polished catalog copy after admin save even if only description field is present on response', () => {
    const product = {
      status: 'pending',
      description: 'This 1-ton split inverter air conditioner is engineered for efficient cooling.',
      publishedDescription: '',
      supplierDescription: 'Specification Value Air Conditioner Type Split Inverter AC'
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe('');
  });

  it('uses published catalog copy for approved products', () => {
    const product = {
      status: 'approved',
      description: 'Published buyer-facing copy.',
      supplierDescription: 'Older supplier draft.'
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe('Published buyer-facing copy.');
    expect(getAdminSupplierSubmittedDescription(product)).toBe('Older supplier draft.');
    expect(getAdminReviewProductDescription(product)).toBe('Published buyer-facing copy.');
  });

  it('prefers buyer-facing copy on list cards once admin saved polish', () => {
    const product = {
      status: 'pending',
      description: 'Polished buyer-facing copy saved by admin.',
      publishedDescription: 'Polished buyer-facing copy saved by admin.',
      supplierDescription: 'Raw supplier submission.'
    };
    expect(getAdminReviewProductDescription(product)).toBe(
      'Polished buyer-facing copy saved by admin.'
    );
  });

  it('shows the supplier listing copy when catalog identity does not match this offer', () => {
    const product = {
      status: 'approved',
      name: 'Milton Thermosteel Flask',
      catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.',
      category: 'flasks & bottles',
      catalogCategory: 'footwear',
      description: 'A suede ballet flat for evening wear.',
      supplierDescription: 'Stainless steel flask keeps drinks hot and cold.'
    };
    expect(getAdminBuyerFacingCatalogDescription(product)).toBe('');
    expect(getAdminReviewProductDescription(product)).toBe(
      'Stainless steel flask keeps drinks hot and cold.'
    );
  });
});

describe('looksLikeSpecificationDump', () => {
  it('detects multi-line spec key/value dumps', () => {
    const dump = [
      'Air Conditioner Type: Split',
      'Cooling Capacity: 1.5 Ton',
      'Star Rating: 5'
    ].join('\n');
    expect(looksLikeSpecificationDump(dump)).toBe(true);
  });

  it('does not flag normal prose descriptions', () => {
    expect(
      looksLikeSpecificationDump('This inverter split AC keeps rooms cool with efficient performance.')
    ).toBe(false);
  });
});
