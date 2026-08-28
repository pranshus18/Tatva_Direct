import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendResolvedPayloadEntry,
  buildAdminReviewChainPayload,
  buildApprovedProfileItems,
  buildBrandReviewItems,
  entryNeedsAdminReview,
  snapshotPayloadEntriesAsResolved
} from '../services/supplierChainAdminService.js';

test('entryNeedsAdminReview is false when role already matches approved profile', () => {
  assert.equal(
    entryNeedsAdminReview({ role: 'dealer', brands: 'hp' }, { role: 'dealer', brands: 'hp' }),
    false
  );
});

test('entryNeedsAdminReview is true when role documents change', () => {
  assert.equal(
    entryNeedsAdminReview(
      { role: 'retailer', brands: 'jaquar', authorizationCertificateUrls: ['https://cdn.example.com/a.png'] },
      { role: 'retailer', brands: 'jaquar', authorizationCertificateUrls: ['https://cdn.example.com/b.png'] }
    ),
    true
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

test('buildBrandReviewItems all filter keeps request history with submission times', () => {
  const rows = [
    {
      id: 'req-rejected',
      user_id: 'user-1',
      status: 'rejected',
      created_at: '2026-06-09T08:49:41.000Z',
      reviewed_at: '2026-06-09T09:00:00.000Z',
      rejection_reason: 'not wanted to aprove',
      payload: {
        companyInfoEntries: [
          { id: 'e1', role: 'retailer', brands: 'apple' },
          { id: 'e2', role: 'retailer', brands: 'acc' }
        ]
      }
    },
    {
      id: 'req-approved',
      user_id: 'user-2',
      status: 'approved',
      created_at: '2026-06-10T10:00:00.000Z',
      payload: {
        companyInfoEntries: [{ id: 'e3', role: 'dealer', brands: 'Milton' }],
        resolvedEntries: [
          {
            id: 'e3',
            role: 'dealer',
            brands: 'Milton',
            reviewStatus: 'approved',
            reviewedAt: '2026-06-10T11:00:00.000Z'
          }
        ]
      }
    }
  ];
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'karthik',
      email: 'karthik@gmail.com',
      company: 'Tatva',
      user_type: 'supplier',
      profile: { companyInfoEntries: [] }
    },
    'user-2': {
      id: 'user-2',
      name: 'Pranshu Singh',
      email: 'pranshu.s@gmail.com',
      company: 'ALL INDIA FOOTBALL FEDERATION',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e3', role: 'dealer', brands: 'Milton' }]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap, { statusFilter: 'all' });
  const rejected = items.filter((item) => item.status === 'rejected');
  const approved = items.filter((item) => item.status === 'approved' && item.brand === 'Milton');

  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((item) => item.submittedAt === '2026-06-09T08:49:41.000Z'));
  assert.equal(approved.length, 1);
  assert.equal(approved[0].submittedAt, '2026-06-10T10:00:00.000Z');
});

test('buildBrandReviewItems approved history does not hide a later live assignment of the same brand', () => {
  const rows = [
    {
      id: 'req-old',
      user_id: 'user-1',
      status: 'rejected',
      created_at: '2026-05-01T00:00:00.000Z',
      payload: {
        companyInfoEntries: [{ id: 'e1', role: 'retailer', brands: 'acc' }]
      }
    }
  ];
  const userMap = {
    'user-1': {
      id: 'user-1',
      name: 'Karthik',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'acc' }]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap, { statusFilter: 'all' });
  assert.equal(items.length, 2);
  assert.ok(items.some((item) => item.status === 'rejected' && item.role === 'retailer'));
  assert.ok(items.some((item) => item.status === 'approved' && item.role === 'dealer'));
});

test('appendResolvedPayloadEntry moves entry to history and removes it from pending', () => {
  const payload = {
    supplierRole: 'dealer',
    brands: 'acc',
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'acc' },
      { id: 'e2', role: 'dealer', brands: 'hp' }
    ]
  };
  const entry = payload.companyInfoEntries[0];
  const nowIso = '2026-06-10T11:00:00.000Z';

  const next = appendResolvedPayloadEntry(payload, entry, {
    status: 'approved',
    reviewedAt: nowIso
  });

  assert.equal(next.companyInfoEntries.length, 1);
  assert.equal(next.companyInfoEntries[0].brands, 'hp');
  assert.equal(next.resolvedEntries.length, 1);
  assert.equal(next.resolvedEntries[0].brands, 'acc');
  assert.equal(next.resolvedEntries[0].reviewStatus, 'approved');
  assert.equal(next.resolvedEntries[0].reviewedAt, nowIso);
});

test('snapshotPayloadEntriesAsResolved appends multiple entries to history', () => {
  const payload = {
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'acc' },
      { id: 'e2', role: 'retailer', brands: 'hp' }
    ]
  };
  const nowIso = '2026-06-10T12:00:00.000Z';

  const next = snapshotPayloadEntriesAsResolved(payload, payload.companyInfoEntries, {
    status: 'approved',
    reviewedAt: nowIso
  });

  assert.equal(next.resolvedEntries.length, 2);
  assert.equal(next.resolvedEntries[0].brands, 'acc');
  assert.equal(next.resolvedEntries[1].brands, 'hp');
  assert.equal(next.resolvedEntries[0].reviewStatus, 'approved');
  assert.equal(next.resolvedEntries[1].reviewedAt, nowIso);
});

test('buildBrandReviewItems approved filter includes suppliers with profile only (no request rows)', () => {
  const userMap = {
    'user-sparsha': {
      id: 'user-sparsha',
      name: 'Sparsha',
      email: 'sparsha@example.com',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'HP' }]
      }
    }
  };

  const items = buildBrandReviewItems([], userMap, { statusFilter: 'approved' });
  assert.equal(items.length, 1);
  assert.equal(items[0].user?.name, 'Sparsha');
  assert.equal(items[0].brand, 'HP');
  assert.equal(items[0].status, 'approved');
});

test('buildBrandReviewItems backfills legacy approved requests with empty payload from profile', () => {
  const rows = [
    {
      id: 'req-legacy',
      user_id: 'user-sparsha',
      status: 'approved',
      created_at: '2026-06-01T10:00:00.000Z',
      reviewed_at: '2026-06-01T11:00:00.000Z',
      payload: { companyInfoEntries: [] }
    }
  ];
  const userMap = {
    'user-sparsha': {
      id: 'user-sparsha',
      name: 'Sparsha',
      user_type: 'supplier',
      profile: {
        companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'HP' }]
      }
    }
  };

  const items = buildBrandReviewItems(rows, userMap, { statusFilter: 'approved' });
  assert.equal(items.length, 1);
  assert.equal(items[0].brand, 'HP');
  assert.equal(items[0].reviewedAt, '2026-06-01T11:00:00.000Z');
  assert.equal(items[0].submittedAt, '2026-06-01T10:00:00.000Z');
});
