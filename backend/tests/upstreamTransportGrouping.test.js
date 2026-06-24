import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransportGroupId,
  buildShippingAddressKey,
  consolidatePoTransportGroups,
  normalizeAddress
} from '../controllers/po/shared/poHelpers.js';

const SUPPLIER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUPPLIER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const WAREHOUSE = {
  line1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India'
};

/** Mirrors SupplierPlaceOrder poGroups useMemo. */
function buildPlaceOrderGroups(reviewLines, checkoutShipping, deliveryDestination = 'shipping', billing = {}) {
  const effectiveDeliveryAddress = normalizeAddress(
    deliveryDestination === 'billing' ? billing : checkoutShipping
  );
  const groupsByTransportKey = new Map();

  for (const line of reviewLines || []) {
    const vendorId = line?.supplierId != null ? String(line.supplierId).trim() : '';
    if (!vendorId) continue;

    const lineShipping =
      line?.shippingAddress && typeof line.shippingAddress === 'object'
        ? normalizeAddress(line.shippingAddress)
        : effectiveDeliveryAddress;
    const transportGroupId = buildTransportGroupId(vendorId, lineShipping);

    if (!groupsByTransportKey.has(transportGroupId)) {
      groupsByTransportKey.set(transportGroupId, {
        vendorId,
        transportGroupId,
        shippingAddress: { ...lineShipping },
        vendorName: line?.supplierName || 'Supplier',
        total: 0,
        items: []
      });
    }

    const g = groupsByTransportKey.get(transportGroupId);
    const qty = Number(line?.quantity || 0) || 0;
    const unitPrice = Number(line?.unitPrice || 0) || 0;
    const lineTotal = Number(line?.lineTotal ?? qty * unitPrice) || 0;
    g.total += lineTotal;
    g.items.push({ name: line?.productName || 'Product', quantity: qty, price: unitPrice });
  }

  return consolidatePoTransportGroups(Array.from(groupsByTransportKey.values()));
}

/** Mirrors preview-groups API raw → consolidate path. */
function buildPreviewGroups(reviewLines, shippingAddress) {
  const defaultDelivery = normalizeAddress(shippingAddress || {});
  const rawGroups = [];

  for (const line of reviewLines || []) {
    const vendorId = String(line?.supplierId || '').trim();
    if (!vendorId) continue;
    const lineShipping = line?.shippingAddress
      ? normalizeAddress(line.shippingAddress)
      : defaultDelivery;
    const transportGroupId = buildTransportGroupId(vendorId, lineShipping);
    const qty = Number(line?.quantity || 0) || 0;
    const unitPrice = Number(line?.unitPrice || 0) || 0;
    const lineTotal = Number(line?.lineTotal ?? qty * unitPrice) || 0;

    rawGroups.push({
      vendorId,
      transportGroupId,
      shippingAddress: lineShipping,
      vendorName: String(line?.supplierName || 'Supplier'),
      total: lineTotal,
      items: [{ name: String(line?.productName || 'Product'), quantity: qty, price: unitPrice }]
    });
  }

  return consolidatePoTransportGroups(rawGroups);
}

test('consolidatePoTransportGroups clubs same supplier + same shipping address', () => {
  const transportGroupId = buildTransportGroupId(SUPPLIER_A, WAREHOUSE);

  const groups = consolidatePoTransportGroups([
    {
      vendorId: SUPPLIER_A,
      transportGroupId,
      shippingAddress: WAREHOUSE,
      vendorName: 'Acme Stockist',
      total: 100,
      items: [{ name: 'Cement A', quantity: 2, price: 50 }]
    },
    {
      vendorId: SUPPLIER_A,
      transportGroupId,
      shippingAddress: WAREHOUSE,
      vendorName: 'Acme Stockist',
      total: 200,
      items: [{ name: 'Cement B', quantity: 4, price: 50 }]
    }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].total, 300);
  assert.equal(groups[0].transportGroupId, transportGroupId);
});

test('consolidatePoTransportGroups keeps separate groups for different delivery addresses', () => {
  const shipA = { line1: 'Site A', city: 'Pune', state: 'MH', pincode: '411001', country: 'India' };
  const shipB = { line1: 'Site B', city: 'Mumbai', state: 'MH', pincode: '400001', country: 'India' };

  const groups = consolidatePoTransportGroups([
    {
      vendorId: SUPPLIER_A,
      transportGroupId: buildTransportGroupId(SUPPLIER_A, shipA),
      shippingAddress: shipA,
      vendorName: 'Same Supplier',
      total: 50,
      items: [{ name: 'Item 1', quantity: 1, price: 50 }]
    },
    {
      vendorId: SUPPLIER_A,
      transportGroupId: buildTransportGroupId(SUPPLIER_A, shipB),
      shippingAddress: shipB,
      vendorName: 'Same Supplier',
      total: 75,
      items: [{ name: 'Item 2', quantity: 1, price: 75 }]
    }
  ]);

  assert.equal(groups.length, 2);
});

test('place-order simulation: 3 lines same supplier → 1 group → 1 transport button', () => {
  const reviewLines = [
    {
      supplierId: SUPPLIER_A,
      supplierName: 'Acme Stockist',
      productName: 'cement2',
      quantity: 10,
      unitPrice: 100,
      lineTotal: 1000,
      shippingAddress: WAREHOUSE
    },
    {
      supplierId: SUPPLIER_A,
      supplierName: 'Acme Stockist',
      productName: 'cement 1',
      quantity: 20,
      unitPrice: 90,
      lineTotal: 1800,
      shippingAddress: WAREHOUSE
    },
    {
      supplierId: SUPPLIER_A,
      supplierName: 'Acme Stockist',
      productName: 'Mac Air M2',
      quantity: 5,
      unitPrice: 50000,
      lineTotal: 250000,
      shippingAddress: WAREHOUSE
    }
  ];

  const groups = buildPlaceOrderGroups(reviewLines, WAREHOUSE);

  assert.equal(groups.length, 1, 'expected one clubbed group for same supplier + address');
  assert.equal(groups[0].items.length, 3, 'all three products in one group');
  assert.equal(groups[0].total, 252800);
  assert.equal(groups[0].vendorName, 'Acme Stockist');
});

test('place-order simulation: 2 suppliers same address → 2 groups → 2 transport buttons', () => {
  const reviewLines = [
    { supplierId: SUPPLIER_A, supplierName: 'Acme', productName: 'P1', quantity: 1, unitPrice: 100, shippingAddress: WAREHOUSE },
    { supplierId: SUPPLIER_B, supplierName: 'Beta', productName: 'P2', quantity: 1, unitPrice: 200, shippingAddress: WAREHOUSE },
    { supplierId: SUPPLIER_A, supplierName: 'Acme', productName: 'P3', quantity: 2, unitPrice: 50, shippingAddress: WAREHOUSE }
  ];

  const groups = buildPlaceOrderGroups(reviewLines, WAREHOUSE);

  assert.equal(groups.length, 2);
  const acme = groups.find((g) => g.vendorId === SUPPLIER_A);
  const beta = groups.find((g) => g.vendorId === SUPPLIER_B);
  assert.equal(acme?.items.length, 2);
  assert.equal(beta?.items.length, 1);
});

test('street vs line1 aliases produce the same transport group key', () => {
  const viaLine1 = buildTransportGroupId(SUPPLIER_A, WAREHOUSE);
  const viaStreet = buildTransportGroupId(SUPPLIER_A, {
    street: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    zipCode: '560001',
    country: 'India'
  });
  assert.equal(viaLine1, viaStreet);
  assert.equal(buildShippingAddressKey(WAREHOUSE), buildShippingAddressKey({
    street: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    zipCode: '560001',
    country: 'India'
  }));
});

test('preview-groups API path matches place-order grouping for multi-item cart', () => {
  const reviewLines = [
    { supplierId: SUPPLIER_A, supplierName: 'Acme', productName: 'cement2', quantity: 10, unitPrice: 100, shippingAddress: WAREHOUSE },
    { supplierId: SUPPLIER_A, supplierName: 'Acme', productName: 'cement 1', quantity: 20, unitPrice: 90, shippingAddress: WAREHOUSE }
  ];

  const fromPlaceOrder = buildPlaceOrderGroups(reviewLines, WAREHOUSE);
  const fromPreviewApi = buildPreviewGroups(reviewLines, WAREHOUSE);

  assert.equal(fromPlaceOrder.length, fromPreviewApi.length);
  assert.equal(fromPlaceOrder[0].items.length, fromPreviewApi[0].items.length);
  assert.equal(fromPlaceOrder[0].transportGroupId, fromPreviewApi[0].transportGroupId);
});

test('backend order grouping key: multiple lines same supplier → one order bucket', () => {
  const selectedDeliveryAddress = normalizeAddress(WAREHOUSE);
  const groups = new Map();

  const lines = [
    { upstreamSupplierId: SUPPLIER_A, qty: 10 },
    { upstreamSupplierId: SUPPLIER_A, qty: 20 },
    { upstreamSupplierId: SUPPLIER_A, qty: 5 }
  ];

  for (const line of lines) {
    const groupKey = buildTransportGroupId(line.upstreamSupplierId, selectedDeliveryAddress);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { supplierId: line.upstreamSupplierId, transportGroupId: groupKey, items: [] });
    }
    groups.get(groupKey).items.push({ quantity: line.qty });
  }

  assert.equal(groups.size, 1);
  assert.equal([...groups.values()][0].items.length, 3);
});
