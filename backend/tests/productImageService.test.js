import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeProductImageLists,
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

test('mergeProductImageLists still combines lists for catalog sync / buyer discovery', () => {
  assert.deepEqual(
    mergeProductImageLists(
      ['https://cdn.example.com/a.jpg'],
      ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/a.jpg']
    ),
    ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']
  );
});
