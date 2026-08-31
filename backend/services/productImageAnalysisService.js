import {
  buildVisionImageSetFingerprint,
  getProductImageAnalysisCache,
  parseVisionImagesFromRequest,
  PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
  resolveProductImageVisionModelId,
  setProductImageAnalysisCache
} from './productImageAnalysisCacheService.js';
import {
  buildProductImageAnalysisResponse,
  parseVisionModelJson
} from './productImageAnalysisReview.js';

export const MIN_PRODUCT_IMAGE_ANALYSIS_COUNT = 1;

function buildStableCategoryExamples(categories = []) {
  const names = (categories || [])
    .map((cat) => String(cat?.display_name || cat?.name || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return names.join(', ');
}

export function buildProductImageVisionPrompt(imageCount, categoryExamples) {
  return `You are given ${imageCount} photos of the SAME product (different angles or details). Analyze them together and identify:
1. Product Name: A clear, concise product name (e.g., "Portland Cement OPC 53", "Safari Stellar Cabin Trolley", "OnePlus Nord CE")
2. Unit: Selling unit if visible on pack/label (examples: kg, g, litre, ml, meter, piece, nos, bag, box, sheet, bundle)
3. Brand: Brand/manufacturer name if visible
4. GTIN / UPC / EAN: Barcode number if clearly visible
5. Category: A short category name (for example: ${categoryExamples || 'steel, cement, luggage, electronics, hardware, plumbing'}).

IMPORTANT:
- Use ALL images together — labels, texture, shape, and packaging may appear in different shots
- Extract text exactly as visible on the image label/packaging (verbatim, no normalization)
- Do NOT guess or infer missing values
- If a field is not clearly readable, return null for that field
- GTIN / UPC / EAN must be returned only when all digits are clearly readable
- For each field, include a confidence score between 0 and 1
- Confidence is mandatory; do not omit confidence keys even when value is null
- For uncertain fields, include your best possible candidate in fieldStatus.<field>.suggestedValue (if you can)
- Keep fieldStatus reasons short (max 12 words each)
- You MAY reuse one of the example categories or output a NEW category if it fits better
- Return ONLY valid JSON with no additional text

Return this JSON structure:
{
  "productName": "exact product name text from packaging or null",
  "unit": "exact unit text from image or null",
  "brand": "brand name or null",
  "gtin": "8/12/13/14 digit GTIN/UPC/EAN string or null",
  "category": "one of the categories from the list",
  "confidence": {
    "productName": 0.0,
    "unit": 0.0,
    "brand": 0.0,
    "gtin": 0.0,
    "category": 0.0
  },
  "fieldStatus": {
    "productName": { "isCertain": true, "reason": "why this value is certain/uncertain", "suggestedValue": "optional candidate when uncertain" },
    "unit": { "isCertain": true, "reason": "why this value is certain/uncertain", "suggestedValue": "optional candidate when uncertain" },
    "brand": { "isCertain": true, "reason": "why this value is certain/uncertain", "suggestedValue": "optional candidate when uncertain" },
    "gtin": { "isCertain": true, "reason": "why this value is certain/uncertain", "suggestedValue": "optional candidate when uncertain" },
    "category": { "isCertain": true, "reason": "why this value is certain/uncertain", "suggestedValue": "optional candidate when uncertain" }
  }
}`;
}

async function callGeminiVision({ geminiApiKey, modelId, prompt, visionImages, fetchImpl }) {
  const geminiParts = [{ text: prompt }];
  for (const img of visionImages) {
    geminiParts.push({
      inline_data: {
        mime_type: img.mimeType.includes('/') ? img.mimeType : 'image/jpeg',
        data: img.base64
      }
    });
  }

  const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${geminiApiKey}`;

  const response = await fetchImpl(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: geminiParts }],
      generationConfig: {
        temperature: 0,
        topP: 1,
        topK: 1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Gemini Vision API error (${modelId}): ${errorData.slice(0, 240)}`);
  }

  const data = await response.json();
  const textFromParts = (data?.candidates || [])
    .flatMap((c) => c?.content?.parts || [])
    .map((p) => (typeof p?.text === 'string' ? p.text.trim() : ''))
    .find(Boolean);

  if (!textFromParts) {
    const finishReason = data?.candidates?.[0]?.finishReason || '';
    const blockReason = data?.promptFeedback?.blockReason || '';
    throw new Error(
      `No response from Gemini Vision API${finishReason || blockReason ? ` (${[blockReason, finishReason].filter(Boolean).join(' | ')})` : ''}`
    );
  }

  return parseVisionModelJson(textFromParts);
}

/**
 * Analyze product photos with a deterministic Gemini call and shared cache keyed by image bytes.
 * Same photos (any upload order) → same extraction for every supplier.
 */
export async function analyzeSupplierProductImages({
  supabase,
  images,
  categories = [],
  geminiApiKey,
  fetchImpl = globalThis.fetch
}) {
  if (!geminiApiKey) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.');
  }

  const normalizedInputs = parseVisionImagesFromRequest(images);
  if (normalizedInputs.length < MIN_PRODUCT_IMAGE_ANALYSIS_COUNT) {
    const err = new Error(
      `Please upload at least ${MIN_PRODUCT_IMAGE_ANALYSIS_COUNT} product photo${MIN_PRODUCT_IMAGE_ANALYSIS_COUNT === 1 ? '' : 's'} so AI can identify the product.`
    );
    err.statusCode = 400;
    throw err;
  }

  const { imageSetHash, orderedImages } = buildVisionImageSetFingerprint(normalizedInputs);
  const modelId = resolveProductImageVisionModelId();

  const cached = await getProductImageAnalysisCache(supabase, imageSetHash);
  if (cached?.payload) {
    return {
      ...cached.payload,
      analysisMeta: {
        ...(cached.payload.analysisMeta || {}),
        cacheHit: true,
        cacheSource: cached.source,
        imageSetHash,
        promptVersion: PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
        model: modelId
      }
    };
  }

  const categoryExamples = buildStableCategoryExamples(categories);
  const prompt = buildProductImageVisionPrompt(orderedImages.length, categoryExamples);
  const parsed = await callGeminiVision({
    geminiApiKey,
    modelId,
    prompt,
    visionImages: orderedImages,
    fetchImpl
  });

  const responsePayload = buildProductImageAnalysisResponse(parsed, {
    provider: 'gemini',
    modelId,
    analysisMeta: {
      cacheHit: false,
      imageSetHash,
      promptVersion: PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
      model: modelId
    }
  });

  await setProductImageAnalysisCache(supabase, {
    imageSetHash,
    imageCount: orderedImages.length,
    payload: responsePayload,
    provider: 'gemini',
    modelId
  });

  return responsePayload;
}

export {
  buildVisionImageSetFingerprint,
  parseVisionImagesFromRequest,
  PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
  resolveProductImageVisionModelId
};
