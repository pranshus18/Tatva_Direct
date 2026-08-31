import { describe, expect, it } from 'vitest';
import {
  getSupplierNotificationTargetPath,
  isLowStockAlertNotification
} from './supplierNotificationDisplay.js';

describe('supplierNotificationDisplay LSA alerts', () => {
  it('recognizes LSA notifications and links to the supplier dashboard', () => {
    const notification = {
      type: 'system',
      title: 'Low stock alert: inventory below LSA',
      metadata: {
        source: 'low_inventory',
        kind: 'inventory_below_lsa'
      }
    };
    expect(isLowStockAlertNotification(notification)).toBe(true);
    expect(getSupplierNotificationTargetPath(notification)).toBe('/supplier-dashboard');
    expect(
      isLowStockAlertNotification({ title: 'Low stock alert: inventory reached LSA' })
    ).toBe(true);
  });

  it('still routes brand rejection to select-yourself', () => {
    expect(
      getSupplierNotificationTargetPath({
        type: 'brand_rejected',
        title: 'Brand rejected'
      })
    ).toBe('/supplier-select-yourself');
  });
});
