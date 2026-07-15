import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVariantOptions,
  enrichDiscoverySuggestionsWithVariantCounts
} from '../services/productDiscoveryDetailService.js';

test('buildVariantOptions returns selectors only for attributes that differ', () => {
  const options = buildVariantOptions([
    {
      specifications: { color: 'Red', size: 'M', brandModel: 'X' },
      canonicalAttributes: {}
    },
    {
      specifications: { color: 'Blue', size: 'M', brandModel: 'X' },
      canonicalAttributes: {}
    }
  ]);

  assert.equal(options.length, 1);
  assert.equal(options[0].key, 'color');
  assert.deepEqual(options[0].values, ['Blue', 'Red']);
});

test('enrichDiscoverySuggestionsWithVariantCounts marks family siblings as variants', async () => {
  const familyId = '11111111-1111-1111-1111-111111111111';
  const suggestions = [
    { id: 'product-a', family_id: familyId },
    { id: 'product-b', family_id: null }
  ];

  const supabase = {
    from(table) {
      if (table === 'products') {
        return {
          select() {
            return this;
          },
          in(_column, values) {
            this._values = values;
            return this;
          },
          eq() {
            return this;
          },
          or() {
            return Promise.resolve({
              data: (this._values || []).flatMap((id) => [
                { id: `${id}-1`, family_id: familyId },
                { id: `${id}-2`, family_id: familyId }
              ])
            });
          }
        };
      }
      if (table === 'supplier_products') {
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          eq() {
            return this;
          },
          then(resolve) {
            return Promise.resolve({ data: [] }).then(resolve);
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const enriched = await enrichDiscoverySuggestionsWithVariantCounts(supabase, suggestions);
  assert.equal(enriched[0].variantCount, 2);
  assert.equal(enriched[0].hasVariants, true);
  assert.equal(enriched[1].variantCount, 1);
  assert.equal(enriched[1].hasVariants, false);
});
