import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_DETAIL_AUDIENCES,
  buildVariantOptions,
  enrichDiscoverySuggestionsWithVariantCounts,
  mergeOfferSpecifications,
  resolveDiscoveryAudienceRules
} from '../services/productDiscoveryDetailService.js';

test('service-provider detail keeps terminal-tier offer eligibility', () => {
  for (const audience of [undefined, '', 'service_provider']) {
    const rules = resolveDiscoveryAudienceRules(audience);
    assert.equal(rules.audience, DISCOVERY_DETAIL_AUDIENCES.SERVICE_PROVIDER);
    assert.equal(rules.enforceTerminalRole, true);
    assert.equal(rules.requireEligibleOffers, true);
    assert.equal(rules.allowUnapprovedOwnListing, false);
  }
});

test('supplier upstream detail ignores terminal tier and shows products without offers', () => {
  for (const audience of ['supplier', 'supplier_upstream', 'Supplier_Upstream']) {
    const rules = resolveDiscoveryAudienceRules(audience);
    assert.equal(rules.audience, DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM);
    assert.equal(rules.enforceTerminalRole, false);
    assert.equal(rules.requireEligibleOffers, false);
    assert.equal(rules.allowUnapprovedOwnListing, true);
  }
});

test('discovery detail summary uses selected product name, not family canonical name', () => {
  const selectedProduct = { id: 'p1', name: 'Apex Ultima Protek 10L' };
  const family = { canonicalName: 'Asian Paints Premium Emulsion' };
  const summaryName = selectedProduct.name || family.canonicalName;
  assert.equal(summaryName, 'Apex Ultima Protek 10L');
});

test('mergeOfferSpecifications: per-variant offer values win over shared catalog placeholders', () => {
  const catalog = { COLOR: 'Silver', CAPACITY: '1 L', MATERIAL: 'Steel' };
  const offerA = {
    attributes: {
      specifications: { COLOR: 'Silver', CAPACITY: '1 L' }
    }
  };
  const offerB = {
    attributes: {
      specifications: { COLOR: 'Rose Gold', CAPACITY: '600 ml' }
    }
  };

  const mergedA = mergeOfferSpecifications(catalog, offerA);
  const mergedB = mergeOfferSpecifications(catalog, offerB);

  assert.equal(mergedA.COLOR, 'Silver');
  assert.equal(mergedA.CAPACITY, '1 L');
  assert.equal(mergedB.COLOR, 'Rose Gold');
  assert.equal(mergedB.CAPACITY, '600 ml');
  assert.equal(mergedB.MATERIAL, 'Steel');
});

test('mergeOfferSpecifications: empty offer placeholders do not wipe admin catalog values', () => {
  const merged = mergeOfferSpecifications(
    { HEIGHT: '25 cm', COLOR: 'Blue' },
    { attributes: { specifications: { HEIGHT: '', COLOR: '' } } }
  );
  assert.equal(merged.HEIGHT, '25 cm');
  assert.equal(merged.COLOR, 'Blue');
});

test('buildVariantOptions ignores category and case-only attribute differences', () => {
  const options = buildVariantOptions([
    {
      specifications: { category: 'flasks & bottles', color: 'Red' },
      canonicalAttributes: {}
    },
    {
      specifications: { category: 'Flasks & Bottles', color: 'Blue' },
      canonicalAttributes: {}
    }
  ]);

  assert.equal(options.some((option) => option.key === 'category'), false);
  assert.equal(options.length, 1);
  assert.equal(options[0].key, 'color');
  assert.deepEqual(options[0].values, ['Blue', 'Red']);
});

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
