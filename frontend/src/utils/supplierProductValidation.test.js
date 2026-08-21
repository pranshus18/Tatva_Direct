import { describe, expect, it } from 'vitest';
import { SUPPLIER_CURRENT_STOCK_LABEL, SUPPLIER_MRP_LABEL } from './supplierStockLabel';
import {
  countSupplierProductPhotos,
  formatInventoryRequiredForProductCovMessage,
  formatMissingProductPhotosMessage,
  formatSupplierProductValidationMessage,
  getSupplierCatalogMandatoryMissingFields,
  getSupplierInventoryCompletionMissingFields,
  getSupplierInventoryUpdateMissingFields,
  getSupplierProductCreateErrorMessage,
  getSupplierProductUpdateErrorMessage,
  INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE,
  PRODUCT_COV_OPEN_FROM_PRODUCT_MESSAGE,
  isSupplierInventoryCompleteForProductCov,
  MIN_SUPPLIER_PRODUCT_PHOTOS
} from './supplierProductValidation';

describe('supplierProductValidation', () => {
  it('lists missing inventory fields', () => {
    expect(getSupplierInventoryUpdateMissingFields({})).toEqual([
      SUPPLIER_MRP_LABEL,
      SUPPLIER_CURRENT_STOCK_LABEL,
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

  it('blocks Product COV until mandatory inventory fields are saved', () => {
    expect(isSupplierInventoryCompleteForProductCov({ price: 0, stock: 0 })).toBe(false);
    expect(
      getSupplierInventoryCompletionMissingFields({
        price: 0,
        stock: 0,
        attributes: { sgstRate: 9, cgstRate: 9, igstRate: 18 }
      })
    ).toEqual([SUPPLIER_MRP_LABEL]);
    expect(
      getSupplierInventoryCompletionMissingFields({
        price: 0,
        stock: 0,
        sgst_rate: null,
        cgst_rate: null,
        igst_rate: null
      })
    ).toEqual([SUPPLIER_MRP_LABEL, 'SGST', 'CGST', 'IGST']);
    expect(
      formatInventoryRequiredForProductCovMessage(['SGST', 'CGST', 'IGST'])
    ).toBe(
      'Inventory completion is required before Product COV. Please complete: SGST, CGST, IGST.'
    );
    expect(formatInventoryRequiredForProductCovMessage([])).toBe(
      INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE
    );
    expect(PRODUCT_COV_OPEN_FROM_PRODUCT_MESSAGE).toMatch(/Manage Products/i);
    expect(PRODUCT_COV_OPEN_FROM_PRODUCT_MESSAGE).toMatch(/Manage Inventory/i);
    expect(
      isSupplierInventoryCompleteForProductCov({
        price: 120,
        stock: 0,
        sgst_rate: 9,
        cgst_rate: 9,
        igst_rate: 18
      })
    ).toBe(true);
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
    expect(
      getSupplierProductCreateErrorMessage({
        message:
          'duplicate key value violates unique constraint "supplier_products_product_supplier_location_variant_key"'
      })
    ).toMatch(/already added this exact product variation/i);
    expect(
      getSupplierProductCreateErrorMessage({
        code: 'duplicate_supplier_variant',
        message: 'You have already added this exact product variation for this location. Please update the existing entry instead.'
      })
    ).toMatch(/already added this exact product variation/i);
    expect(
      getSupplierProductCreateErrorMessage({
        message: 'duplicate key value violates unique constraint "idx_products_barcode"'
      })
    ).toMatch(/identity already exists/i);
    expect(
      getSupplierProductCreateErrorMessage({
        message: 'duplicate key value violates unique constraint "idx_products_barcode"'
      })
    ).not.toMatch(/idx_products_barcode|duplicate key/i);
    expect(
      getSupplierProductCreateErrorMessage({
        details:
          'Key (product_id, supplier_id, location, variant_key)=(aaa, bbb, , vk-1) already exists.',
        code: '23505'
      })
    ).toMatch(/already added this exact product variation/i);
    expect(
      getSupplierProductCreateErrorMessage({
        details:
          'Key (product_id, supplier_id, location, variant_key)=(aaa, bbb, , vk-1) already exists.',
        code: '23505'
      })
    ).not.toMatch(/duplicate key|unique constraint|23505/i);
    expect(
      getSupplierProductCreateErrorMessage({
        code: 'role_required',
        message:
          'Before adding products, the brand must be approved and you must select/add your supplier role in Select yourself.'
      })
    ).toMatch(/supplier role/i);
  });
});
