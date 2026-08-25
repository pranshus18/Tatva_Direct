import { describe, expect, it } from 'vitest';
import {
  buildManageInventorySearchParams,
  inferDeclaredBrandFromProductName,
  isListingBrandLocked,
  listingBrandsConflict,
  pickInventoryDeepLinkMatch,
  resolveListingBrandIdentity
} from './productBrandIdentity';

describe('product brand identity', () => {
  const declared = ['JBL', 'Nothing', 'Nothing Audio'];

  it('infers Nothing from Nothing Power (45W)', () => {
    expect(inferDeclaredBrandFromProductName('Nothing Power (45W)', declared)).toBe('Nothing');
  });

  it('prefers the longer declared brand when both match', () => {
    expect(inferDeclaredBrandFromProductName('Nothing Audio Ear Stick', declared)).toBe(
      'Nothing Audio'
    );
  });

  it('does not infer JBL from a Nothing product name', () => {
    expect(inferDeclaredBrandFromProductName('Nothing Power (45W)', ['JBL'])).toBeNull();
  });

  it('replaces a leftover JBL brand when the title is a Nothing product', () => {
    expect(
      resolveListingBrandIdentity({
        selectedBrand: 'JBL',
        catalogBrand: 'JBL',
        productName: 'Nothing Power (45W)',
        declaredLabels: declared
      })
    ).toBe('Nothing');
  });

  it('keeps JBL when the title does not name another declared brand', () => {
    expect(
      resolveListingBrandIdentity({
        selectedBrand: 'JBL',
        productName: 'Wireless Over-Ear Headphones',
        declaredLabels: declared
      })
    ).toBe('JBL');
  });

  it('builds inventory URLs with the resolved brand and product name', () => {
    const params = buildManageInventorySearchParams({
      brand: 'Nothing',
      productName: 'Nothing Power (45W)',
      supplierProductId: 'offer-1'
    });
    expect(params.get('brand')).toBe('Nothing');
    expect(params.get('productName')).toBe('Nothing Power (45W)');
    expect(params.get('supplierProductId')).toBe('offer-1');
    expect(params.get('from')).toBe('product-management');
    expect(listingBrandsConflict('Nothing', 'JBL')).toBe(true);
    expect(listingBrandsConflict('Nothing', 'Nothing Audio')).toBe(false);
  });

  it('opens a Nothing listing even when the inventory URL still has leftover JBL', () => {
    const rows = [
      { id: 'jbl-1', name: 'JBL Wireless Over-Ear Headphones', brand: 'JBL' },
      {
        id: 'offer-2',
        supplier_product_id: 'offer-2',
        name: 'Nothing Power (45W)',
        brand: 'Nothing'
      }
    ];
    expect(
      pickInventoryDeepLinkMatch(rows, {
        brand: 'jbl',
        productName: 'Nothing Power (45W)',
        supplierProductId: 'offer-2'
      })?.id
    ).toBe('offer-2');
    expect(
      pickInventoryDeepLinkMatch(rows, {
        brand: 'jbl',
        productName: 'Nothing Power (45W)'
      })?.brand
    ).toBe('Nothing');
  });

  it('unlocks brand when a saved listing name conflicts with leftover JBL', () => {
    expect(
      isListingBrandLocked({
        product: { id: '1' },
        selectedBrand: 'JBL',
        productName: 'Nothing Power (45W)',
        declaredLabels: declared
      })
    ).toBe(false);
    expect(
      isListingBrandLocked({
        product: { id: '1' },
        selectedBrand: 'Nothing',
        productName: 'Nothing Power (45W)',
        declaredLabels: declared
      })
    ).toBe(true);
  });
});
