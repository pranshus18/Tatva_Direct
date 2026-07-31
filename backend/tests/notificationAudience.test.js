import assert from 'node:assert/strict';
import {
  filterNotificationsForRole,
  isNotificationVisibleToRole,
  isSupplierUserType
} from '../utils/notificationAudience.js';

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

test('hides product_approval from service providers', () => {
  const notification = {
    type: 'product_approval',
    title: 'Product Rejected: HP LaserJet',
    message: 'Your product has been rejected by admin.',
    is_read: false
  };
  assert.equal(isNotificationVisibleToRole(notification, 'service_provider'), false);
  assert.equal(isNotificationVisibleToRole(notification, 'supplier'), true);
});

test('keeps procurement order_status for service providers', () => {
  const notification = {
    type: 'order_status',
    title: 'Order shipped',
    message: 'Supplier updated your order',
    is_read: false
  };
  assert.equal(isNotificationVisibleToRole(notification, 'service_provider'), true);
});

test('keeps SP request-status system notifications', () => {
  const approved = {
    type: 'system',
    title: 'Your requested product was approved: Widget',
    metadata: { source: 'service_provider_request_approved' },
    is_read: false
  };
  const rejected = {
    type: 'system',
    title: 'Your requested product was rejected: Widget',
    metadata: { source: 'service_provider_request_rejected' },
    is_read: true
  };
  const submitted = {
    type: 'system',
    title: 'Product request submitted: Widget',
    metadata: { source: 'service_provider_product_request' },
    is_read: false
  };
  assert.equal(isNotificationVisibleToRole(approved, 'service_provider'), true);
  assert.equal(isNotificationVisibleToRole(rejected, 'service_provider'), true);
  assert.equal(isNotificationVisibleToRole(submitted, 'service_provider'), true);
  assert.equal(isNotificationVisibleToRole(approved, 'supplier'), false);
});

test('hides supplier broadcast New Product Available from SPs', () => {
  const notification = {
    type: 'system',
    title: 'New Product Available: Widget',
    metadata: { source: 'service_provider_request' },
    is_read: false
  };
  assert.equal(isNotificationVisibleToRole(notification, 'service_provider'), false);
  assert.equal(isNotificationVisibleToRole(notification, 'supplier'), true);
});

test('filterNotificationsForRole recomputes unread for SP inbox', () => {
  const { notifications, unreadCount } = filterNotificationsForRole(
    [
      {
        type: 'product_approval',
        title: 'Product Rejected: A',
        is_read: false
      },
      {
        type: 'order_status',
        title: 'PO updated',
        is_read: false
      },
      {
        type: 'payment_receipt',
        title: 'Receipt ready',
        is_read: true
      }
    ],
    'service_provider'
  );
  assert.equal(notifications.length, 2);
  assert.equal(unreadCount, 1);
});

test('isSupplierUserType only matches suppliers', () => {
  assert.equal(isSupplierUserType('supplier'), true);
  assert.equal(isSupplierUserType('service_provider'), false);
  assert.equal(isSupplierUserType('Service Provider'), false);
  assert.equal(isSupplierUserType('admin'), false);
});

console.log('notificationAudience tests passed');
