import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVisionImageSetFingerprint,
  clearProductImageAnalysisMemoryCacheForTests,
  normalizeVisionImageInput,
  parseVisionImagesFromRequest,
  setProductImageAnalysisCache,
  getProductImageAnalysisCache
} from '../services/productImageAnalysisCacheService.js';
import { analyzeSupplierProductImages } from '../services/productImageAnalysisService.js';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';
const TINY_WEBP_BASE64 =
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

test('normalizeVisionImageInput strips data URI prefix and fingerprints bytes', () => {
  const withPrefix = normalizeVisionImageInput(`data:image/png;base64,${TINY_PNG_BASE64}`, 'image/png');
  const bare = normalizeVisionImageInput(TINY_PNG_BASE64, 'image/png');
  assert.ok(withPrefix);
  assert.ok(bare);
  assert.equal(withPrefix.contentHash, bare.contentHash);
  assert.equal(withPrefix.base64, bare.base64);
});

test('buildVisionImageSetFingerprint is stable regardless of upload order', () => {
  const imgA = normalizeVisionImageInput(TINY_PNG_BASE64, 'image/png');
  const imgB = normalizeVisionImageInput(TINY_JPEG_BASE64, 'image/jpeg');
  const imgC = normalizeVisionImageInput(TINY_WEBP_BASE64, 'image/webp');

  const forward = buildVisionImageSetFingerprint([imgA, imgB, imgC]);
  const shuffled = buildVisionImageSetFingerprint([imgC, imgA, imgB]);
  const reversed = buildVisionImageSetFingerprint([imgB, imgC, imgA]);

  assert.equal(forward.imageSetHash, shuffled.imageSetHash);
  assert.equal(forward.imageSetHash, reversed.imageSetHash);
  assert.deepEqual(
    forward.orderedImages.map((img) => img.base64),
    shuffled.orderedImages.map((img) => img.base64)
  );
});

test('buildVisionImageSetFingerprint changes when any image differs', () => {
  const imgA = normalizeVisionImageInput(TINY_PNG_BASE64, 'image/png');
  const imgB = normalizeVisionImageInput(TINY_JPEG_BASE64, 'image/jpeg');
  const imgC = normalizeVisionImageInput(TINY_WEBP_BASE64, 'image/webp');
  const imgD = normalizeVisionImageInput(TINY_PNG_BASE64, 'image/jpeg');

  const setAbc = buildVisionImageSetFingerprint([imgA, imgB, imgC]);
  const setAbd = buildVisionImageSetFingerprint([imgA, imgB, imgD]);

  assert.notEqual(setAbc.imageSetHash, setAbd.imageSetHash);
});

test('parseVisionImagesFromRequest accepts mixed payload shapes', () => {
  const parsed = parseVisionImagesFromRequest([
    { data: TINY_PNG_BASE64, mimeType: 'image/png' },
    { base64: TINY_JPEG_BASE64, mime: 'image/jpeg' },
    { imageBase64: TINY_WEBP_BASE64, mimeType: 'image/webp' }
  ]);
  assert.equal(parsed.length, 3);
});

test('getProductImageAnalysisCache returns shared memory entry for same image set', async () => {
  clearProductImageAnalysisMemoryCacheForTests();

  const imgA = normalizeVisionImageInput(TINY_PNG_BASE64, 'image/png');
  const imgB = normalizeVisionImageInput(TINY_JPEG_BASE64, 'image/jpeg');
  const imgC = normalizeVisionImageInput(TINY_WEBP_BASE64, 'image/webp');
  const { imageSetHash } = buildVisionImageSetFingerprint([imgA, imgB, imgC]);

  const payload = {
    status: 'success',
    productName: 'Shared Cement Bag',
    review: { accepted: { productName: 'Shared Cement Bag' } }
  };

  await setProductImageAnalysisCache(null, {
    imageSetHash,
    imageCount: 3,
    payload,
    provider: 'gemini',
    modelId: 'gemini-2.5-flash'
  });

  const cached = await getProductImageAnalysisCache(null, imageSetHash);
  assert.ok(cached);
  assert.equal(cached.source, 'memory');
  assert.equal(cached.payload.productName, 'Shared Cement Bag');
});

test('analyzeSupplierProductImages reuses cache and skips Gemini for identical photos', async () => {
  clearProductImageAnalysisMemoryCacheForTests();

  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      productName: 'Fresh Gemini Name',
                      unit: 'bag',
                      brand: 'TestBrand',
                      gtin: null,
                      category: 'cement',
                      confidence: {
                        productName: 0.95,
                        unit: 0.9,
                        brand: 0.88,
                        gtin: 0,
                        category: 0.92
                      },
                      fieldStatus: {
                        productName: { isCertain: true, reason: 'label visible', suggestedValue: null },
                        unit: { isCertain: true, reason: 'pack text', suggestedValue: null },
                        brand: { isCertain: true, reason: 'logo visible', suggestedValue: null },
                        gtin: { isCertain: false, reason: 'not visible', suggestedValue: null },
                        category: { isCertain: true, reason: 'packaging type', suggestedValue: null }
                      }
                    })
                  }
                ]
              }
            }
          ]
        };
      }
    };
  };

  const images = [
    { data: TINY_PNG_BASE64, mimeType: 'image/png' },
    { data: TINY_JPEG_BASE64, mimeType: 'image/jpeg' },
    { data: TINY_WEBP_BASE64, mimeType: 'image/webp' }
  ];

  const first = await analyzeSupplierProductImages({
    supabase: null,
    images,
    categories: [{ display_name: 'Cement' }, { display_name: 'Steel' }],
    geminiApiKey: 'test-key',
    fetchImpl
  });

  assert.equal(fetchCalls, 1);
  assert.equal(first.productName, 'Fresh Gemini Name');
  assert.equal(first.analysisMeta.cacheHit, false);

  const second = await analyzeSupplierProductImages({
    supabase: null,
    images: [images[2], images[0], images[1]],
    categories: [{ display_name: 'Steel' }, { display_name: 'Cement' }],
    geminiApiKey: 'test-key',
    fetchImpl
  });

  assert.equal(fetchCalls, 1, 'second supplier with same photos should hit cache');
  assert.equal(second.productName, 'Fresh Gemini Name');
  assert.equal(second.analysisMeta.cacheHit, true);
  assert.equal(first.analysisMeta.imageSetHash, second.analysisMeta.imageSetHash);
});
