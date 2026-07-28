import { describe, expect, it } from 'vitest';
import { filterSpNotifications, isSpVisibleNotification } from './spNotificationAudience.js';

describe('spNotificationAudience', () => {
  it('hides supplier product rejection alerts', () => {
    expect(
      isSpVisibleNotification({
        type: 'product_approval',
        title: 'Product Rejected: HP LaserJet Pro MFP 4104dw Printer',
        message: 'Your product has been rejected by admin. Reason: want to remove'
      })
    ).toBe(false);
  });

  it('keeps order and payment procurement notifications', () => {
    expect(
      isSpVisibleNotification({
        type: 'order_status',
        title: 'Order confirmed'
      })
    ).toBe(true);
    expect(
      isSpVisibleNotification({
        type: 'payment_receipt',
        title: 'Payment receipt'
      })
    ).toBe(true);
  });

  it('keeps request-status system notifications', () => {
    expect(
      isSpVisibleNotification({
        type: 'system',
        title: 'Your requested product was rejected: Widget',
        metadata: { source: 'service_provider_request_rejected' }
      })
    ).toBe(true);
  });

  it('filters list and unread count', () => {
    const { notifications, unreadCount } = filterSpNotifications([
      { type: 'product_approval', title: 'Product Rejected: A', is_read: false },
      { type: 'order_status', title: 'Supplier response', is_read: false },
      { type: 'system', title: 'New Product Available: B', metadata: { source: 'service_provider_request' }, is_read: false }
    ]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Supplier response');
    expect(unreadCount).toBe(1);
  });
});
