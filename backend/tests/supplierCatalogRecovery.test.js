import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBaseProductIfNeeded,
  findExistingProductCandidate,
  isSameCatalogProductForRecovery
} from '../services/supplierProductWriteService.js';
import { buildIdentityBundle } from '../services/productIdentityService.js';

const flaskIdentity = buildIdentityBundle({
  name: 'Milton Thermosteel Flask',
  category: 'flasks & bottles',
  brand: 'Milton',
  unit: 'piece'
});

test('isSameCatalogProductForRecovery rejects an ASIN-only collision with another category', () => {
  assert.equal(
    isSameCatalogProductForRecovery(
      {
        id: 'stella-1',
        name: 'Stella Suede Ballet Flat with Iridescent Accent.',
        category: 'footwear',
        brand: 'Stella',
        asin: flaskIdentity.asinLikeId,
        catalog_key: 'other-key'
      },
      flaskIdentity
    ),
    false
  );
});

test('isSameCatalogProductForRecovery accepts the same catalog key', () => {
  assert.equal(
    isSameCatalogProductForRecovery(
      {
        id: 'flask-1',
        name: 'Milton Thermosteel Flask',
        category: 'flasks & bottles',
        brand: 'Milton',
        catalog_key: flaskIdentity.catalogKey
      },
      flaskIdentity
    ),
    true
  );
});

function createInsertThenLookupSupabase({ firstError, recoveredByAsin, retryProduct }) {
  let insertCount = 0;
  return {
    from() {
      return {
        insert(payload) {
          return {
            select() {
              return {
                async single() {
                  insertCount += 1;
                  if (insertCount === 1) {
                    return { data: null, error: firstError };
                  }
                  return {
                    data: retryProduct || { id: 'new-flask', asin: payload.asin },
                    error: null
                  };
                }
              };
            }
          };
        },
        select() {
          const query = {
            eq(column, value) {
              query._column = column;
              query._value = value;
              return query;
            },
            async maybeSingle() {
              if (query._column === 'asin') {
                return { data: recoveredByAsin || null, error: null };
              }
              return { data: null, error: null };
            }
          };
          return query;
        }
      };
    }
  };
}

test('findExistingProductCandidate ignores a stale catalog id from a different category', async () => {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    ilike() {
      return Promise.resolve({ data: [], error: null });
    },
    async maybeSingle() {
      return {
        data: {
          id: 'stella-1',
          name: 'Stella Suede Ballet Flat with Iridescent Accent.',
          category: 'footwear',
          brand: 'Milton'
        },
        error: null
      };
    }
  };
  const supabase = {
    from() {
      return query;
    }
  };

  const result = await findExistingProductCandidate(supabase, {
    selectedCatalogProductId: 'stella-1',
    identityBundle: flaskIdentity,
    productName: 'milton thermosteel flask',
    productNameRaw: 'Milton Thermosteel Flask',
    categoryName: 'flasks & bottles',
    normalizeText: (value) => String(value || '').trim().toLowerCase()
  });

  assert.equal(result.product, null);
  assert.equal(result.matchStrength, 'none');
});

test('createBaseProductIfNeeded does not attach a flask to footwear after an ASIN collision', async () => {
  const supabase = createInsertThenLookupSupabase({
    firstError: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_products_asin_not_blank"',
      details: `Key (asin)=(${flaskIdentity.asinLikeId}) already exists.`
    },
    recoveredByAsin: {
      id: 'stella-1',
      name: 'Stella Suede Ballet Flat with Iridescent Accent.',
      category: 'footwear',
      brand: 'Stella',
      asin: flaskIdentity.asinLikeId,
      catalog_key: 'stella-key'
    },
    retryProduct: { id: 'new-flask', asin: 'TSXYZ' }
  });

  const result = await createBaseProductIfNeeded(supabase, {
    existingProduct: null,
    otherData: { name: 'Milton Thermosteel Flask', price: 899, stock: 75 },
    categoryName: 'flasks & bottles',
    unitName: 'piece',
    normalizedImageUrls: ['https://example.com/flask.jpg'],
    normalizedSpecs: { Material: 'Stainless Steel', Height: '28 cm' },
    reqUserId: 'supplier-1',
    identityBundle: flaskIdentity,
    resolvedBarcodeForPos: null
  });

  assert.equal(result.productId, 'new-flask');
  assert.equal(result.isNewProduct, true);
  assert.equal(result.error, undefined);
});
