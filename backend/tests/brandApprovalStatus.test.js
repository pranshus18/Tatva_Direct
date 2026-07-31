import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureBrandApprovedOrRequest,
  resolveBrandApprovalStatus
} from '../services/brandApprovalService.js';

function createSupabaseMock({ brandRow = null, error = null } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: brandRow, error }),
                limit: () => ({
                  maybeSingle: async () => ({ data: brandRow, error })
                })
              };
            },
            ilike() {
              return {
                maybeSingle: async () => ({ data: brandRow, error })
              };
            }
          };
        }
      };
    }
  };
}

test('resolveBrandApprovalStatus requires a brand name', async () => {
  const result = await resolveBrandApprovalStatus({
    supabase: createSupabaseMock(),
    brandName: '   '
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'missing');
  assert.equal(result.code, 'brand_required');
});

test('ensureBrandApprovedOrRequest does not auto-approve from approved product evidence', async () => {
  const pendingBrand = {
    id: 'brand-srushti',
    name: 'srushti',
    normalized_name: 'srushti',
    status: 'pending',
    requested_by: 'user-1'
  };
  let updatedPayload = null;

  const supabase = {
    from(table) {
      if (table === 'brands') {
        return {
          select() {
            return {
              order: async () => ({ data: [pendingBrand], error: null }),
              eq() {
                return {
                  maybeSingle: async () => ({ data: pendingBrand, error: null })
                };
              }
            };
          },
          update(payload) {
            updatedPayload = payload;
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({
                        data: { ...pendingBrand, ...payload },
                        error: null
                      })
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'category_supply_chains') {
        return {
          select: async () => ({ data: [], error: null })
        };
      }
      if (table === 'supplier_products') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit: async () => ({
                        data: [
                          {
                            status: 'approved',
                            is_active: true,
                            attributes: { brand: 'srushti' },
                            product: { status: 'approved', brand: 'srushti' }
                          }
                        ],
                        error: null
                      })
                    };
                  }
                };
              }
            };
          }
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null })
              };
            }
          };
        }
      };
    }
  };

  const result = await ensureBrandApprovedOrRequest({
    supabase,
    brandName: 'srushti',
    requesterUserId: 'user-1'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'brand_approval_pending');
  assert.equal(result.brand?.status, 'pending');
  assert.equal(updatedPayload, null);
});

test('ensureBrandApprovedOrRequest does not auto-approve from supply-chain alone', async () => {
  const pendingSamsung = {
    id: 'brand-samsung',
    name: 'Samsung',
    normalized_name: 'samsung',
    status: 'pending',
    requested_by: 'user-1'
  };
  let updatedPayload = null;

  const supabase = {
    from(table) {
      if (table === 'brands') {
        return {
          select() {
            return {
              order: async () => ({ data: [pendingSamsung], error: null }),
              eq() {
                return {
                  maybeSingle: async () => ({ data: pendingSamsung, error: null })
                };
              }
            };
          },
          update(payload) {
            updatedPayload = payload;
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({
                        data: { ...pendingSamsung, ...payload },
                        error: null
                      })
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'category_supply_chains') {
        return {
          select: async () => ({
            data: [
              {
                category_name: 'Samsung',
                stages: [{ role: 'manufacturer' }, { role: 'dealer' }],
                updated_at: '2026-07-01T00:00:00.000Z'
              }
            ],
            error: null
          })
        };
      }
      if (table === 'supplier_products') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit: async () => ({ data: [], error: null })
                    };
                  }
                };
              }
            };
          }
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    limit: async () => ({ data: [], error: null })
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const result = await ensureBrandApprovedOrRequest({
    supabase,
    brandName: 'Samsung',
    requesterUserId: 'user-1'
  });

  // Supply-chain definition ≠ brand approval. Pending brands stay pending for admin review.
  assert.equal(result.ok, false);
  assert.equal(result.code, 'brand_approval_pending');
  assert.equal(result.brand?.status, 'pending');
  assert.equal(updatedPayload, null);
});
