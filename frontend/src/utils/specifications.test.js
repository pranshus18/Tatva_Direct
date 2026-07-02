import { describe, it, expect } from 'vitest';
import { parseSpecificationsForDisplay } from './specifications.js';

describe('parseSpecificationsForDisplay', () => {
  it('hides internal identity bundle from order line-item chips', () => {
    const specs = {
      identity: {
        catalog: { name: 'mac air m1', category: 'laptop', brand: 'apple', gtin: '23546753846473' },
        catalogKey: '0414904c0119837475e7f334de1f67c1394057d37f7a48a187451569fb5be691',
        variantKey: 'cc184adc5078b56493ce6f3a27694727067236a8acd8756707dfaf73f5ce6604',
        matchSignals: { hasGtin: true, hasMpn: true, hasSerial: true }
      },
      cityCode: 'Pun-840',
      serialNumber: 'SN-04'
    };

    const entries = parseSpecificationsForDisplay(specs);
    const labels = entries.map((entry) => entry.label.toLowerCase());

    expect(labels).not.toContain('identity');
    expect(labels).not.toContain('catalog key');
    expect(labels).not.toContain('match signals');
    expect(labels).toContain('city code');
    expect(labels).toContain('serial number');
  });
});
