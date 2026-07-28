import { describe, expect, it } from 'vitest';
import {
  getProductImageList,
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

  it('falls back to product.images when attributes have no images', () => {
    const product = {
      images: ['https://cdn.example.com/only.jpg']
    };
    expect(getSupplierOfferImagesForForm(product)).toEqual([
      'https://cdn.example.com/only.jpg'
    ]);
  });
});
