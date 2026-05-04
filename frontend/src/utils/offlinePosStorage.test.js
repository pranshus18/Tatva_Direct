import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheBarcodeLookup,
  clearSyncedPosOrders,
  enqueuePosOrder,
  getCachedBarcodeLookup,
  getPendingPosOrders,
  loadPosQueue,
  markPosOrderSynced
} from './offlinePosStorage';

describe('offlinePosStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('queues POS orders and returns pending entries', () => {
    const queued = enqueuePosOrder({ amount: 450, items: 2 });
    const queue = loadPosQueue();
    const pending = getPendingPosOrders();

    expect(queue).toHaveLength(1);
    expect(queued.status).toBe('pending');
    expect(pending).toHaveLength(1);
  });

  it('marks queued order as synced and clears synced records', () => {
    const queued = enqueuePosOrder({ amount: 1200 });
    markPosOrderSynced(queued.id, 'ORD-1001');

    const pendingAfterSync = getPendingPosOrders();
    const remainingQueue = clearSyncedPosOrders();

    expect(pendingAfterSync).toHaveLength(0);
    expect(remainingQueue).toHaveLength(0);
  });

  it('caches barcode lookup by scan context', () => {
    cacheBarcodeLookup({
      barcode: '1234567890',
      outletId: 'outlet-1',
      scanType: 'gsku',
      product: { name: 'Primer', price: 200 }
    });

    const cached = getCachedBarcodeLookup({
      barcode: '1234567890',
      outletId: 'outlet-1',
      scanType: 'gsku'
    });

    expect(cached).not.toBeNull();
    expect(cached.product.name).toBe('Primer');
  });
});
