import { describe, it, expect } from 'vitest';
import {
  buildTransportGroupId,
  consolidatePoTransportGroups,
  normalizeShippingAddress,
  isTransportSelectionReady,
  getTransportGroupKey
} from '../utils/poTransportSelection.js';

const SUPPLIER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WAREHOUSE = {
  line1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  country: 'India'
};

describe('upstream transport clubbing (frontend)', () => {
  it('clubs 3 review lines from same supplier into one group', () => {
    const transportGroupId = buildTransportGroupId(SUPPLIER_A, WAREHOUSE);
    const reviewLines = ['cement2', 'cement 1', 'Mac Air M2'].map((name, i) => ({
      supplierId: SUPPLIER_A,
      supplierName: 'Acme Stockist',
      productName: name,
      quantity: i + 1,
      unitPrice: 100,
      shippingAddress: WAREHOUSE
    }));

    const groupsByKey = new Map();
    for (const line of reviewLines) {
      const vendorId = String(line.supplierId);
      const lineShipping = normalizeShippingAddress(line.shippingAddress);
      const key = buildTransportGroupId(vendorId, lineShipping);
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, {
          vendorId,
          transportGroupId: key,
          shippingAddress: lineShipping,
          vendorName: line.supplierName,
          total: 0,
          items: []
        });
      }
      const g = groupsByKey.get(key);
      g.total += line.quantity * line.unitPrice;
      g.items.push({ name: line.productName });
    }

    const groups = consolidatePoTransportGroups([...groupsByKey.values()]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].transportGroupId).toBe(transportGroupId);
  });

  it('requires one transport pick per clubbed group', () => {
    const transportGroupId = buildTransportGroupId(SUPPLIER_A, WAREHOUSE);
    const groups = [
      {
        vendorId: SUPPLIER_A,
        transportGroupId,
        vendorName: 'Acme',
        items: [{}, {}, {}]
      }
    ];
    const ready = isTransportSelectionReady(
      { byVendorId: { [transportGroupId]: 'Delhivery' } },
      groups
    );
    expect(ready).toBe(true);
    expect(getTransportGroupKey(groups[0])).toBe(transportGroupId);
  });
});
