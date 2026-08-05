import test from 'node:test';
import assert from 'node:assert/strict';

test('resolveAdminTargetOfferRow prefers explicit supplier_product_id', async () => {
  const { resolveAdminTargetOfferRow } = await import('../controllers/admin/productCatalogRoutes.js');
  const rows = [
    { id: 'offer-600', price: 100, status: 'approved', is_active: true, stock: 10 },
    { id: 'offer-1000', price: 150, status: 'approved', is_active: true, stock: 10 }
  ];

  const picked = resolveAdminTargetOfferRow(rows, {
    validatedBody: { supplier_product_id: 'offer-1000' },
    catalogStatus: 'approved',
    primarySupplierId: 'supplier-1'
  });

  assert.equal(picked?.id, 'offer-1000');
});

test('pickSupplierOfferRowForAdmin prefers pending offer when requested', async () => {
  const { pickSupplierOfferRowForAdmin } = await import('../controllers/admin/productCatalogRoutes.js');
  const rows = [
    { id: 'offer-approved', price: 100, status: 'approved', is_active: true, stock: 20, updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'offer-pending', price: 120, status: 'pending', is_active: false, stock: 5, updated_at: '2026-02-01T00:00:00.000Z' }
  ];

  const picked = pickSupplierOfferRowForAdmin(rows, {
    catalogStatus: 'approved',
    preferPending: true
  });

  assert.equal(picked?.id, 'offer-pending');
});

test('expandCatalogProductIntoAdminReviewRows creates one admin row per supplier offer', async () => {
  const { expandCatalogProductIntoAdminReviewRows } = await import('../controllers/admin/productCatalogRoutes.js');
  const rows = expandCatalogProductIntoAdminReviewRows(
    {
      id: 'prod-1',
      name: 'Logitech Mouse',
      status: 'approved',
      category: 'electronics',
      specifications: { color: 'Black' }
    },
    [
      {
        id: 'offer-a',
        supplier_id: 'sup-1',
        status: 'approved',
        price: 100,
        stock: 10,
        variant_key: 'v1',
        variant_asin: 'TSA7V1',
        updated_at: '2026-01-01T00:00:00.000Z',
        attributes: { specifications: { color: 'Black', dpi: '1000' } }
      },
      {
        id: 'offer-b',
        supplier_id: 'sup-2',
        status: 'pending',
        price: 120,
        stock: 5,
        variant_key: 'v2',
        variant_asin: 'TSA7V2',
        updated_at: '2026-02-01T00:00:00.000Z',
        attributes: { specifications: { color: 'Black', dpi: '1600' } }
      }
    ],
    {
      'sup-1': { id: 'sup-1', name: 'Supplier A' },
      'sup-2': { id: 'sup-2', name: 'Supplier B' }
    }
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].adminRowKey, 'prod-1:offer-b');
  assert.equal(rows[0].displayStatus, 'pending');
  assert.equal(rows[1].displayStatus, 'approved');
  assert.match(rows[0].variantLabel || '', /1600/i);
});

test('resolveAdminTargetOfferRow falls back to best offer when no explicit id', async () => {
  const { resolveAdminTargetOfferRow } = await import('../controllers/admin/productCatalogRoutes.js');
  const rows = [
    { id: 'offer-600', price: 100, status: 'approved', is_active: true, stock: 5 },
    { id: 'offer-1000', price: 150, status: 'approved', is_active: true, stock: 20 }
  ];

  const picked = resolveAdminTargetOfferRow(rows, {
    validatedBody: {},
    catalogStatus: 'approved',
    primarySupplierId: null
  });

  assert.equal(picked?.id, 'offer-1000');
});
