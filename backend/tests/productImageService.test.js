import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichOrderItemsWithVariantImages,
  enrichProductsWithOfferImages,
  mergeProductImageLists,
  resolveOrderLineDisplayImages,
  resolveSellerOwnedListingImages,
  resolveSupplierOfferDisplayImages
} from '../services/productImageService.js';

test('resolveSupplierOfferDisplayImages returns only offer images when present', () => {
  const offer = ['https://cdn.example.com/offer-a.jpg', 'https://cdn.example.com/offer-b.jpg'];
  const catalog = ['https://cdn.example.com/old-catalog.jpg', 'https://cdn.example.com/offer-a.jpg'];
  assert.deepEqual(resolveSupplierOfferDisplayImages(offer, catalog), offer);
});

test('resolveSupplierOfferDisplayImages keeps explicit empty offer list (deleted photos)', () => {
  const catalog = ['https://cdn.example.com/old-catalog.jpg'];
  assert.deepEqual(resolveSupplierOfferDisplayImages([], catalog), []);
});

test('resolveSupplierOfferDisplayImages falls back to catalog when offer images were never set', () => {
  const catalog = ['https://cdn.example.com/old-catalog.jpg'];
  assert.deepEqual(resolveSupplierOfferDisplayImages(null, catalog), catalog);
  assert.deepEqual(resolveSupplierOfferDisplayImages(undefined, catalog), catalog);
});

test('resolveOrderLineDisplayImages prefers snapshot then offer, not merged catalog', () => {
  const snapshot = ['https://cdn.example.com/snap.jpg'];
  const offer = ['https://cdn.example.com/v1.jpg', 'https://cdn.example.com/v2.jpg', 'https://cdn.example.com/v3.jpg'];
  const catalog = [
    'https://cdn.example.com/v1.jpg',
    'https://cdn.example.com/other-variant.jpg',
    'https://cdn.example.com/another.jpg'
  ];
  assert.deepEqual(
    resolveOrderLineDisplayImages({ snapshotImages: snapshot, offerImages: offer, catalogImages: catalog }),
    snapshot
  );
  assert.deepEqual(
    resolveOrderLineDisplayImages({
      offerImages: offer,
      catalogImages: catalog,
      hasSupplierOffer: true
    }),
    offer
  );
  assert.deepEqual(
    resolveOrderLineDisplayImages({
      offerImages: null,
      catalogImages: catalog,
      hasSupplierOffer: true
    }),
    []
  );
});

test('enrichOrderItemsWithVariantImages overwrites product.images with offer gallery', async () => {
  const offerImages = [
    'https://cdn.example.com/v1.jpg',
    'https://cdn.example.com/v2.jpg',
    'https://cdn.example.com/v3.jpg'
  ];
  const catalogImages = [
    ...offerImages,
    'https://cdn.example.com/other-a.jpg',
    'https://cdn.example.com/other-b.jpg'
  ];
  const supabase = {
    from() {
      return {
        select() {
          return {
            in: async () => ({
              data: [{ id: 'offer-1', attributes: { images: offerImages } }],
              error: null
            })
          };
        }
      };
    }
  };

  const [enriched] = await enrichOrderItemsWithVariantImages(supabase, [
    {
      supplier_product_id: 'offer-1',
      product: { id: 'p1', name: 'ACC cement', images: catalogImages },
      specifications: { variantAsin: 'TS2F' }
    }
  ]);

  assert.deepEqual(enriched.images, offerImages);
  assert.deepEqual(enriched.product.images, offerImages);
  assert.equal(enriched.productImage, offerImages[0]);
});

test('enrichProductsWithOfferImages uses one seller gallery, not every supplier merged', async () => {
  const catalog = [
    'https://cdn.example.com/a.jpg',
    'https://cdn.example.com/b.jpg',
    'https://cdn.example.com/c.jpg'
  ];
  const supabase = {
    from() {
      return {
        select() {
          return {
            in() {
              return {
                eq() {
                  return {
                    eq: async () => ({
                      data: [
                        {
                          id: 'offer-a',
                          product_id: 'p1',
                          supplier_id: 'sa',
                          price: 100,
                          stock: 20,
                          attributes: { images: ['https://cdn.example.com/a.jpg'] }
                        },
                        {
                          id: 'offer-b',
                          product_id: 'p1',
                          supplier_id: 'sb',
                          price: 90,
                          stock: 5,
                          attributes: { images: ['https://cdn.example.com/b.jpg'] }
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
  };

  const [enriched] = await enrichProductsWithOfferImages(supabase, [
    { id: 'p1', name: 'ACC cement', images: catalog }
  ]);
  assert.deepEqual(enriched.images, ['https://cdn.example.com/a.jpg']);
});

test('mergeProductImageLists still combines lists for catalog sync / buyer discovery', () => {
  assert.deepEqual(
    mergeProductImageLists(
      ['https://cdn.example.com/a.jpg'],
      ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/a.jpg']
    ),
    ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']
  );
});

test('resolveSellerOwnedListingImages keeps this seller photos and drops a copied catalog dump', () => {
  const catalog = [
    'https://cdn.example.com/a.jpg',
    'https://cdn.example.com/b.jpg',
    'https://cdn.example.com/c.jpg'
  ];
  const offerA = {
    id: 'a',
    supplier_id: 'sa',
    attributes: { images: ['https://cdn.example.com/a.jpg'] }
  };
  const offerB = {
    id: 'b',
    supplier_id: 'sb',
    attributes: { images: ['https://cdn.example.com/b.jpg'] }
  };
  const offerCopied = {
    id: 'c',
    supplier_id: 'sc',
    attributes: { images: catalog }
  };

  assert.deepEqual(
    resolveSellerOwnedListingImages({
      offer: offerA,
      catalogProductOffers: [offerA, offerB, offerCopied],
      catalogImages: catalog
    }),
    ['https://cdn.example.com/a.jpg']
  );
  assert.deepEqual(
    resolveSellerOwnedListingImages({
      offer: offerCopied,
      catalogProductOffers: [offerA, offerB, offerCopied],
      catalogImages: catalog
    }),
    ['https://cdn.example.com/c.jpg']
  );
  assert.deepEqual(
    resolveSellerOwnedListingImages({
      offer: null,
      catalogProductOffers: [offerA, offerB],
      catalogImages: catalog
    }),
    []
  );
});
