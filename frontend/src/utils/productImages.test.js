import { describe, expect, it } from 'vitest';
import {
  getOrderItemImages,
  getProductImageList,
  getSelectedListingImages,
  getSupplierOfferImagesForForm,
  normalizeProductImages
} from './productImages.js';

describe('productImages', () => {
  it('normalizes url arrays', () => {
    expect(
      normalizeProductImages([
        'https://cdn.example.com/a.jpg',
        'not-a-url',
        'https://cdn.example.com/a.jpg'
      ])
    ).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('prefers offer attributes over merged product.images for forms', () => {
    const product = {
      images: [
        'https://cdn.example.com/offer.jpg',
        'https://cdn.example.com/old-catalog.jpg'
      ],
      attributes: {
        images: ['https://cdn.example.com/offer.jpg']
      }
    };
    expect(getSupplierOfferImagesForForm(product)).toEqual([
      'https://cdn.example.com/offer.jpg'
    ]);
    expect(getProductImageList(product)).toEqual(['https://cdn.example.com/offer.jpg']);
  });

  it('does not load catalog product.images into the supplier offer form', () => {
    const product = {
      images: ['https://cdn.example.com/only.jpg']
    };
    expect(getSupplierOfferImagesForForm(product)).toEqual([]);
  });

  it('does not restore catalog images when offer images were explicitly cleared', () => {
    const product = {
      images: ['https://cdn.example.com/old-catalog.jpg'],
      attributes: {
        images: []
      }
    };
    expect(getSupplierOfferImagesForForm(product)).toEqual([]);
    expect(getProductImageList(product)).toEqual([]);
  });

  it('getSelectedListingImages does not fall back to merged catalog product images', () => {
    const listing = {
      supplierProductId: 'offer-1',
      images: ['https://cdn.example.com/this-seller.jpg'],
      attributes: {
        images: ['https://cdn.example.com/this-seller.jpg']
      }
    };
    const catalogSummary = {
      images: [
        'https://cdn.example.com/this-seller.jpg',
        'https://cdn.example.com/other-seller-a.jpg',
        'https://cdn.example.com/other-seller-b.jpg'
      ]
    };
    expect(getSelectedListingImages(listing)).toEqual(['https://cdn.example.com/this-seller.jpg']);
    expect(getSelectedListingImages(null)).toEqual([]);
    expect(getSelectedListingImages({ images: [] })).toEqual([]);
    expect(getProductImageList(listing || catalogSummary)).toEqual([
      'https://cdn.example.com/this-seller.jpg'
    ]);
  });

  it('getOrderItemImages uses variant/order images and ignores catalog product.images', () => {
    const item = {
      images: [
        'https://cdn.example.com/v1.jpg',
        'https://cdn.example.com/v2.jpg',
        'https://cdn.example.com/v3.jpg'
      ],
      product: {
        images: [
          'https://cdn.example.com/v1.jpg',
          'https://cdn.example.com/other-a.jpg',
          'https://cdn.example.com/other-b.jpg'
        ],
        image: 'https://cdn.example.com/v1.jpg'
      }
    };
    expect(getOrderItemImages(item)).toEqual([
      'https://cdn.example.com/v1.jpg',
      'https://cdn.example.com/v2.jpg',
      'https://cdn.example.com/v3.jpg'
    ]);
    expect(
      getOrderItemImages({
        product: {
          images: ['https://cdn.example.com/catalog-only.jpg'],
          image: 'https://cdn.example.com/single.jpg'
        }
      })
    ).toEqual(['https://cdn.example.com/single.jpg']);
  });
});
