import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminReviewChainPayload,
  buildApprovedProfileItems,
  buildBrandReviewItems,
  entryNeedsAdminReview
} from '../services/supplierChainAdminService.js';

test('entryNeedsAdminReview is false when role already matches approved profile', () => {
  assert.equal(
    entryNeedsAdminReview({ role: 'dealer', brands: 'hp' }, { role: 'dealer', brands: 'hp' }),
    false
  );
});

test('entryNeedsAdminReview is true for role changes and new brand assignments', () => {
  assert.equal(
    entryNeedsAdminReview({ role: 'retailer', brands: 'acc' }, { role: 'dealer', brands: 'acc' }),
    true
  );
  assert.equal(entryNeedsAdminReview(null, { role: 'dealer', brands: 'newbrand' }), true);
});

test('buildAdminReviewChainPayload keeps only changed brand entries', () => {
  const baseline = {
    companyInfoEntries: [
      { id: 'e1', role: 'retailer', brands: 'acc', authorizationCertificateUrls: ['https://a.com/1.pdf'] },
      { id: 'e2', role: 'dealer', brands: 'hp', authorizationCertificateUrls: ['https://a.com/2.pdf'] },
      { id: 'e3', role: 'dealer', brands: 'Finolex', authorizationCertificateUrls: ['https://a.com/3.pdf'] }
    ]
  };
  const incoming = {
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'acc', authorizationCertificateUrls: ['https://a.com/9.pdf'] },
      { id: 'e2', role: 'dealer', brands: 'hp', authorizationCertificateUrls: ['https://a.com/2.pdf'] },
      { id: 'e3', role: 'dealer', brands: 'Finolex', authorizationCertificateUrls: ['https://a.com/3.pdf'] }
    ]
  };

  const review = buildAdminReviewChainPayload(baseline, incoming);
  assert.equal(review.companyInfoEntries.length, 1);
  assert.equal(review.companyInfoEntries[0].brands, 'acc');
  assert.equal(review.companyInfoEntries[0].role, 'dealer');
});

test('buildBrandReviewItems returns one item per reviewable brand', () => {
  const rows = [
    {
      id: 'req-1',
      user_id: 'user-1',
      status: 'pending',
      created_at: '2026-06-15T09:00:00.000Z',
      payload: {
        companyInfoEntries: [
          { id: 'e1', role: 'dealer', brands: 'acc', authorizationCertificateUrls: ['https://a.com/1.pdf'] },
          { id: 'e2', role: 'dealer', brands: 'hp', authorizationCertificateUrls: ['https://a.com/2.pdf'] }
        ]
      }
    }
  ];
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'Karthik',
      email: 'karthik@gmail.com',
      company: 'Tatva',
      profile: {
        companyInfoEntries: [
          { id: 'e1', role: 'retailer', brands: 'acc', authorizationCertificateUrls: ['https://a.com/1.pdf'] },
          { id: 'e2', role: 'dealer', brands: 'hp', authorizationCertificateUrls: ['https://a.com/2.pdf'] }
        ]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap);
  assert.equal(items.length, 1);
  assert.equal(items[0].brand, 'acc');
  assert.ok(items.every((item) => item.user?.name === 'Karthik'));
});

test('buildApprovedProfileItems returns saved supplier profile assignments', () => {
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'Karthik',
      email: 'karthik@gmail.com',
      company: 'Tatva',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [
          { id: 'e1', role: 'dealer', brands: 'acc' },
          { id: 'e2', role: 'dealer', brands: 'hp' }
        ]
      }
    }
  };

  const items = buildApprovedProfileItems(userMap);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.brand).sort(),
    ['acc', 'hp']
  );
  assert.ok(items.every((item) => item.status === 'approved'));
});

test('buildBrandReviewItems all filter includes approved profile assignments', () => {
  const rows = [
    {
      id: 'req-1',
      user_id: 'user-1',
      status: 'pending',
      created_at: '2026-06-15T09:00:00.000Z',
      payload: {
        companyInfoEntries: [{ id: 'e3', role: 'dealer', brands: 'newbrand' }]
      }
    }
  ];
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'Karthik',
      email: 'karthik@gmail.com',
      company: 'Tatva',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'acc' }]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap, { statusFilter: 'all' });
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => `${item.brand}:${item.status}`).sort(),
    ['acc:approved', 'newbrand:pending']
  );
});

test('buildBrandReviewItems approved filter uses saved profiles only', () => {
  const rows = [
    {
      id: 'req-1',
      user_id: 'user-1',
      status: 'approved',
      payload: { companyInfoEntries: [] }
    }
  ];
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'Karthik',
      email: 'karthik@gmail.com',
      company: 'Tatva',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'acc' }]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap, { statusFilter: 'approved' });
  assert.equal(items.length, 1);
  assert.equal(items[0].brand, 'acc');
  assert.equal(items[0].status, 'approved');
});
