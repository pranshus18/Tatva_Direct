import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrandApprovalStatus } from '../services/brandApprovalService.js';

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
