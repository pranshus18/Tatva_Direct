import { describe, expect, it } from 'vitest';
import {
  countSupplierProductPhotos,
  formatMissingProductPhotosMessage,
  formatSupplierProductValidationMessage,
  getSupplierCatalogMandatoryMissingFields,
  getSupplierInventoryUpdateMissingFields,
  getSupplierProductCreateErrorMessage,
  getSupplierProductUpdateErrorMessage,
  MIN_SUPPLIER_PRODUCT_PHOTOS
} from './supplierProductValidation';

describe('supplierProductValidation', () => {
  it('lists missing inventory fields', () => {
    expect(getSupplierInventoryUpdateMissingFields({})).toEqual([
      'MRP',
      'Current stock with you',
      'SGST',
      'CGST',
      'IGST'
    ]);
  });

  it('passes complete inventory fields', () => {
    expect(
      getSupplierInventoryUpdateMissingFields({
        price: '100',
        stock: '0',
        sgst_rate: '9',
        cgst_rate: '9',
        igst_rate: '18'
      })
    ).toEqual([]);
  });

  it('requires catalog identity on update', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        { name: '', brand: '', category: '' },
        { isCreate: false, requireUnit: false }
      )
    ).toEqual(['Product name', 'Brand', 'Category']);
  });

  it('requires unit on catalog update when requireUnit is true', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        { name: 'Mouse', brand: 'Logitech', category: 'Electronics', unit: '' },
        { isCreate: false, requireUnit: true }
      )
    ).toEqual(['Unit']);
  });

  it('requires at least 3 uploaded product photos on create', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        {
          name: 'Widget',
          brand: 'Acme',
          category: 'Tools',
          unit: 'pcs',
          images: ['https://cdn.example.com/a.jpg', 'blob:http://localhost/x']
        },
        { isCreate: true, requirePhotos: true, minPhotos: MIN_SUPPLIER_PRODUCT_PHOTOS }
      )
    ).toEqual(['At least 3 product photos']);
  });

  it('passes create validation when 3 http photos are present', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        {
          name: 'Widget',
          brand: 'Acme',
          category: 'Tools',
          unit: 'pcs',
          images: [
            'https://cdn.example.com/a.jpg',
            'https://cdn.example.com/b.jpg',
            'https://cdn.example.com/c.jpg'
          ]
        },
        { isCreate: true, requirePhotos: true }
      )
    ).toEqual([]);
  });

  it('counts only unique http product photos', () => {
    expect(
      countSupplierProductPhotos([
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/a.jpg',
        'blob:http://localhost/1'
      ])
    ).toBe(1);
  });

  it('requires every admin specification key when a category template is loaded', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        {
          name: 'Widget',
          brand: 'Acme',
          category: 'Tools',
          unit: 'pcs'
        },
        {
          isCreate: false,
          requireUnit: true,
          specTemplateKeys: ['Material', 'Size'],
          specifications: { Material: 'Steel', Size: '' }
        }
      )
    ).toEqual(['Specification: Size']);
  });

  it('passes when all admin specification keys are filled', () => {
    expect(
      getSupplierCatalogMandatoryMissingFields(
        {
          name: 'Widget',
          brand: 'Acme',
          category: 'Tools',
          unit: 'pcs'
        },
        {
          isCreate: false,
          requireUnit: true,
          specTemplateKeys: ['Material', 'Size'],
          specifications: { Material: 'Steel', Size: 'Large' }
        }
      )
    ).toEqual([]);
  });

  it('formats photo and API error messages', () => {
    expect(formatMissingProductPhotosMessage(1)).toMatch(/currently have 1/i);
    expect(formatSupplierProductValidationMessage(['MRP', 'SGST'])).toBe(
      'Please complete: MRP, SGST.'
    );
    expect(
      getSupplierProductUpdateErrorMessage({
        errors: ['MRP is required.', 'SGST, CGST, and IGST are all required.']
      })
    ).toBe('MRP is required. SGST, CGST, and IGST are all required.');
    expect(
      getSupplierProductCreateErrorMessage({
        code: 'product_photos_required',
        message: 'At least 3 product photos are required before submitting.'
      })
    ).toBe('At least 3 product photos are required before submitting.');
  });
});
