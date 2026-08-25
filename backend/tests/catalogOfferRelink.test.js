import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offerConflictsWithCatalogProduct,
  relinkConflictingOfferToOwnCatalog
} from '../services/catalogOfferRelinkService.js';

test('offerConflictsWithCatalogProduct detects Nothing Power on a JBL catalog row', () => {
  assert.equal(
    offerConflictsWithCatalogProduct(
      {
        name: 'JBL Wireless Over-Ear Headphones with 57H Playtime',
        brand: 'JBL',
        category: 'electronics'
      },
      {
        attributes: {
          listingName: 'Nothing Power (45W)',
          brand: 'Nothing',
          category: 'electronics'
        }
      }
    ),
    true
  );
  assert.equal(
    offerConflictsWithCatalogProduct(
      { name: 'Nothing Power (45W)', brand: 'Nothing', category: 'electronics' },
      { attributes: { listingName: 'Nothing Power (45W)', brand: 'Nothing', category: 'electronics' } }
    ),
    false
  );
});

test('relinkConflictingOfferToOwnCatalog moves a Nothing offer off the JBL catalog', async () => {
  const updates = [];
  const inserts = [];
  const supabase = {
    from(table) {
      return {
        insert(payload) {
          inserts.push({ table, payload });
          return {
            select() {
              return {
                async single() {
                  return {
                    data: { id: 'nothing-catalog', asin: 'TSNEW1', name: payload.name, brand: payload.brand },
                    error: null
                  };
                }
              };
            }
          };
        },
        update(payload) {
          updates.push({ table, payload });
          return {
            eq() {
              return {
                select() {
                  return {
                    async maybeSingle() {
                      return {
                        data: { id: 'offer-nothing', product_id: payload.product_id, attributes: {} },
                        error: null
                      };
                    }
                  };
                }
              };
            }
          };
        },
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'nothing-catalog',
                      name: 'Nothing Power (45W)',
                      brand: 'Nothing',
                      status: 'pending'
                    },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const result = await relinkConflictingOfferToOwnCatalog(supabase, {
    catalogProduct: {
      id: 'jbl-catalog',
      name: 'JBL Wireless Over-Ear Headphones with 57H Playtime',
      brand: 'JBL',
      category: 'electronics'
    },
    offerRow: {
      id: 'offer-nothing',
      supplier_id: 'sup-1',
      price: 0,
      stock: 0,
      attributes: {
        listingName: 'Nothing Power (45W)',
        brand: 'Nothing',
        category: 'electronics',
        unit: 'piece',
        images: ['https://example.com/nothing.jpg']
      }
    },
    reqUserId: 'sup-1'
  });

  assert.equal(result.relinked, true);
  assert.equal(result.catalogProduct?.id, 'nothing-catalog');
  assert.equal(result.catalogProduct?.name, 'Nothing Power (45W)');
  assert.equal(inserts[0]?.table, 'products');
  assert.equal(inserts[0]?.payload?.name, 'Nothing Power (45W)');
  assert.equal(String(inserts[0]?.payload?.brand || '').toLowerCase(), 'nothing');
  assert.equal(updates.some((row) => row.table === 'supplier_products'), true);
});
