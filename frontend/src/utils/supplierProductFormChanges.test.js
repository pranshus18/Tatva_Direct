import { describe, expect, it } from 'vitest';
import {
  buildSupplierProductEditBaseline,
  buildSupplierProductFormSnapshot,
  diffSupplierProductForm,
  pickChangedSupplierProductFields
} from './supplierProductFormChanges';

const savedProduct = {
  name: 'OPC 53 Cement',
  brand: 'UltraTech',
  gtin: '8901030895463',
  category: 'Cement',
  unit: 'Bag',
  description: '53 grade cement',
  supplierDescription: '53 grade cement',
  price: 350,
  stock: 10,
  lsa: '5',
  hsnCode: '2523',
  igst_rate: 18,
  cgst_rate: 9,
  sgst_rate: 9,
  attributes: {
    images: ['https://cdn.example.com/a.jpg'],
    specifications: { Grade: 'OPC 53' },
    lsa: '5'
  },
  supplierOfferSpecifications: { Grade: 'OPC 53' },
  status: 'pending'
};

function catalogForm(overrides = {}) {
  return {
    name: savedProduct.name,
    brand: savedProduct.brand,
    gtin: savedProduct.gtin,
    category: savedProduct.category,
    unit: savedProduct.unit,
    description: savedProduct.description,
    images: ['https://cdn.example.com/a.jpg'],
    ...overrides
  };
}

function inventoryForm(overrides = {}) {
  return {
    price: '350',
    stock: '10',
    hsnCode: '2523',
    igst_rate: '18',
    cgst_rate: '9',
    sgst_rate: '9',
    lsa: '5',
    images: ['https://cdn.example.com/a.jpg'],
    ...overrides
  };
}

describe('supplierProductFormChanges', () => {
  it('does not treat an untouched catalog form as changed', () => {
    const baseline = buildSupplierProductEditBaseline(savedProduct, { showInventoryFields: false });
    const current = buildSupplierProductFormSnapshot({
      formData: catalogForm(),
      specifications: { Grade: 'OPC 53' },
      showInventoryFields: false
    });
    expect(diffSupplierProductForm(current, baseline).hasChanges).toBe(false);
  });

  it('does not treat whitespace-only or numeric formatting differences as changes', () => {
    const baseline = buildSupplierProductEditBaseline(savedProduct, { showInventoryFields: true });
    const current = buildSupplierProductFormSnapshot({
      formData: inventoryForm({
        price: '350.00',
        stock: '10',
        lsa: ' 5 ',
        hsnCode: '2523'
      }),
      showInventoryFields: true
    });
    expect(diffSupplierProductForm(current, baseline).hasChanges).toBe(false);
  });

  it('detects a catalog name change and picks only that field', () => {
    const baseline = buildSupplierProductEditBaseline(savedProduct, { showInventoryFields: false });
    const formData = catalogForm({ name: 'OPC 43 Cement' });
    const current = buildSupplierProductFormSnapshot({
      formData,
      specifications: { Grade: 'OPC 53' },
      showInventoryFields: false
    });
    const diff = diffSupplierProductForm(current, baseline);
    expect(diff.hasChanges).toBe(true);
    expect(diff.changedKeys).toEqual(['name']);
    expect(
      pickChangedSupplierProductFields(
        { ...formData, brand: 'UltraTech', specifications: { Grade: 'OPC 53' } },
        current,
        baseline
      )
    ).toEqual({ name: 'OPC 43 Cement' });
  });

  it('detects inventory stock change and picks only stock', () => {
    const baseline = buildSupplierProductEditBaseline(savedProduct, { showInventoryFields: true });
    const formData = inventoryForm({ stock: '8' });
    const current = buildSupplierProductFormSnapshot({
      formData,
      showInventoryFields: true
    });
    expect(diffSupplierProductForm(current, baseline).changedKeys).toEqual(['stock']);
    expect(pickChangedSupplierProductFields(formData, current, baseline)).toEqual({ stock: '8' });
  });

  it('sends all GST rates together when one tax field changes', () => {
    const baseline = buildSupplierProductEditBaseline(savedProduct, { showInventoryFields: true });
    const formData = inventoryForm({
      igst_rate: '12',
      cgst_rate: '6',
      sgst_rate: '6'
    });
    const current = buildSupplierProductFormSnapshot({
      formData,
      showInventoryFields: true
    });
    expect(pickChangedSupplierProductFields(formData, current, baseline)).toEqual({
      igst_rate: '12',
      cgst_rate: '6',
      sgst_rate: '6'
    });
  });

  it('treats equal stock and LSA as unchanged inventory', () => {
    const product = { ...savedProduct, stock: 5, lsa: '5' };
    const baseline = buildSupplierProductEditBaseline(product, { showInventoryFields: true });
    const current = buildSupplierProductFormSnapshot({
      formData: inventoryForm({ stock: '5', lsa: '5' }),
      showInventoryFields: true
    });
    expect(diffSupplierProductForm(current, baseline).hasChanges).toBe(false);
  });
});
