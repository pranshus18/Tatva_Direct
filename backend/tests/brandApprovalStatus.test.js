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

test('ensureBrandApprovedOrRequest auto-approves brands with an admin supply chain', async () => {
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

  assert.equal(result.ok, true);
  assert.equal(result.brand?.status, 'approved');
  assert.equal(updatedPayload?.status, 'approved');
});
