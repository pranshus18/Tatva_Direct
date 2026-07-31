import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyServiceProviderProductRequestSubmitted,
  notifyServiceProviderRequestReviewDecision,
  notifyServiceProvidersForFulfilledBoqRequests
} from '../services/serviceProviderRequestNotificationService.js';
import { isNotificationVisibleToRole } from '../utils/notificationAudience.js';

function createInsertCaptureDb({ openRequests = [] } = {}) {
  const inserted = [];
  const updates = [];

  const db = {
    from(table) {
      if (table === 'notifications') {
        return {
          insert(payload) {
            const rows = Array.isArray(payload) ? payload : [payload];
            inserted.push(...rows);
            return Promise.resolve({ error: null });
          }
        };
      }

      if (table === 'product_requests') {
        return {
          select() {
            return {
              eq() {
                return {
                  in() {
                    return {
                      order() {
                        return {
                          limit() {
                            return Promise.resolve({ data: openRequests, error: null });
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          },
          update(payload) {
            return {
              in(ids) {
                updates.push({ table: 'product_requests', payload, ids });
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }

      if (table === 'products') {
        return {
          update(payload) {
            return {
              eq() {
                return {
                  is() {
                    updates.push({ table: 'products', payload });
                    return Promise.resolve({ error: null });
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };

  return { db, inserted, updates };
}

test('notifyServiceProviderProductRequestSubmitted creates an SP-visible system alert', async () => {
  const { db, inserted } = createInsertCaptureDb();
  await notifyServiceProviderProductRequestSubmitted({
    db,
    userId: 'sp-1',
    productName: 'Cement 50kg',
    requestId: 'req-1',
    category: 'construction',
    unit: 'bags',
    brand: 'Ultratech',
    boqId: 'boq-1'
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].user_id, 'sp-1');
  assert.equal(inserted[0].type, 'system');
  assert.equal(inserted[0].metadata.source, 'service_provider_product_request');
  assert.equal(isNotificationVisibleToRole(inserted[0], 'service_provider'), true);
  assert.equal(isNotificationVisibleToRole(inserted[0], 'supplier'), true);
});

test('notifyServiceProviderRequestReviewDecision notifies BOQ requester on approve/reject', async () => {
  const { db, inserted } = createInsertCaptureDb();
  await notifyServiceProviderRequestReviewDecision({
    db,
    request: {
      id: 'req-2',
      requested_by: 'sp-2',
      source: 'boq',
      review_notes: 'Looks good',
      normalized_input: { name: 'Steel Rod' },
      resolved_product_id: null
    },
    decision: 'approved'
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].metadata.source, 'service_provider_request_approved');
  assert.equal(isNotificationVisibleToRole(inserted[0], 'service_provider'), true);
  assert.equal(isNotificationVisibleToRole(inserted[0], 'supplier'), false);
});

test('notifyServiceProviderRequestReviewDecision skips supplier-sourced requests', async () => {
  const { db, inserted } = createInsertCaptureDb();
  const result = await notifyServiceProviderRequestReviewDecision({
    db,
    request: {
      id: 'req-3',
      requested_by: 'supplier-1',
      source: 'supplier',
      normalized_input: { name: 'Paint' }
    },
    decision: 'approved'
  });

  assert.equal(result.notified, false);
  assert.equal(inserted.length, 0);
});

test('notifyServiceProvidersForFulfilledBoqRequests matches open BOQ requests by name', async () => {
  const { db, inserted, updates } = createInsertCaptureDb({
    openRequests: [
      {
        id: 'req-a',
        requested_by: 'sp-a',
        source: 'boq',
        status: 'new',
        normalized_input: { name: 'HP LaserJet', brand: '' }
      },
      {
        id: 'req-b',
        requested_by: 'sp-b',
        source: 'boq',
        status: 'new',
        normalized_input: { name: 'Other Product', brand: '' }
      }
    ]
  });

  const result = await notifyServiceProvidersForFulfilledBoqRequests({
    db,
    product: { id: 'prod-1', name: 'HP LaserJet', brand: null },
    supplier: { id: 'sup-1', name: 'Acme Supplies' }
  });

  assert.equal(result.notifiedCount, 1);
  assert.deepEqual(result.matchedRequestIds, ['req-a']);
  assert.equal(inserted[0].user_id, 'sp-a');
  assert.equal(inserted[0].metadata.source, 'service_provider_request_fulfilled');
  assert.equal(isNotificationVisibleToRole(inserted[0], 'service_provider'), true);
  assert.ok(updates.some((u) => u.table === 'product_requests'));
  assert.ok(updates.some((u) => u.table === 'products'));
});

console.log('serviceProviderRequestNotificationService tests passed');
