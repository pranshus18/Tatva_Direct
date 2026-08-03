import crypto from 'crypto';

/** Bump when the vision prompt or review rules change to invalidate stale cache rows. */
export const PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION = '3';

const MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryEntries = new Map();

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function resolveProductImageVisionModelId() {
  return String(
    process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  ).trim();
}

/**
 * Normalize one uploaded image and fingerprint its pixel bytes (order-independent).
 */
export function normalizeVisionImageInput(rawBase64, mimeType = 'image/jpeg') {
  const cleaned = String(rawBase64 || '')
    .replace(/^data:image\/[\w+.-]+;base64,/i, '')
    .replace(/\s/g, '');
  if (!cleaned) return null;
  let buffer;
  try {
    buffer = Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
  if (!buffer.length) return null;
  const mime = String(mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim() || 'image/jpeg';
  return {
    base64: cleaned,
    mimeType: mime,
    contentHash: sha256Hex(buffer)
  };
}

export function parseVisionImagesFromRequest(images = []) {
  return (Array.isArray(images) ? images : [])
    .map((img) => {
      const raw = img?.data ?? img?.base64 ?? img?.imageBase64;
      const mimeType = (img?.mimeType || img?.mime || 'image/jpeg').toString();
      return normalizeVisionImageInput(raw, mimeType);
    })
    .filter(Boolean);
}

/**
 * Same set of photos in any upload order → same fingerprint and same Gemini input order.
 */
export function buildVisionImageSetFingerprint(normalizedImages = []) {
  const sorted = [...normalizedImages].sort((a, b) => a.contentHash.localeCompare(b.contentHash));
  const modelId = resolveProductImageVisionModelId();
  const seed = [
    PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
    modelId,
    ...sorted.map((img) => img.contentHash)
  ].join('|');
  return {
    imageSetHash: sha256Hex(Buffer.from(seed, 'utf8')),
    orderedImages: sorted.map(({ base64, mimeType }) => ({ base64, mimeType }))
  };
}

function readMemoryCache(imageSetHash) {
  const entry = memoryEntries.get(imageSetHash);
  if (!entry) return null;
  if (Date.now() - entry.storedAtMs > MEMORY_TTL_MS) {
    memoryEntries.delete(imageSetHash);
    return null;
  }
  return entry.payload;
}

function writeMemoryCache(imageSetHash, payload) {
  memoryEntries.set(imageSetHash, { payload, storedAtMs: Date.now() });
}

export async function getProductImageAnalysisCache(supabase, imageSetHash) {
  const fromMemory = readMemoryCache(imageSetHash);
  if (fromMemory) {
    return { payload: fromMemory, source: 'memory' };
  }
  if (!supabase || !imageSetHash) return null;

  try {
    const { data, error } = await supabase
      .from('product_image_analysis_cache')
      .select('response_payload, provider, model_id, prompt_version')
      .eq('image_set_hash', imageSetHash)
      .maybeSingle();

    if (error) {
      const msg = String(error.message || '');
      if (!/product_image_analysis_cache|does not exist|schema cache/i.test(msg)) {
        console.warn('[ProductImageAnalysisCache] read failed:', msg);
      }
      return null;
    }

    if (!data?.response_payload || typeof data.response_payload !== 'object') {
      return null;
    }

    writeMemoryCache(imageSetHash, data.response_payload);
    return { payload: data.response_payload, source: 'database' };
  } catch (err) {
    console.warn('[ProductImageAnalysisCache] read exception:', err?.message || err);
    return null;
  }
}

export async function setProductImageAnalysisCache(supabase, {
  imageSetHash,
  imageCount,
  payload,
  provider,
  modelId
}) {
  if (!imageSetHash || !payload) return;
  writeMemoryCache(imageSetHash, payload);

  if (!supabase) return;

  try {
    const row = {
      image_set_hash: imageSetHash,
      image_count: Number(imageCount) || 0,
      provider: String(provider || 'gemini'),
      model_id: String(modelId || resolveProductImageVisionModelId()),
      prompt_version: PRODUCT_IMAGE_ANALYSIS_PROMPT_VERSION,
      response_payload: payload,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('product_image_analysis_cache').upsert(row, {
      onConflict: 'image_set_hash'
    });
    if (error) {
      const msg = String(error.message || '');
      if (!/product_image_analysis_cache|does not exist|schema cache/i.test(msg)) {
        console.warn('[ProductImageAnalysisCache] write failed:', msg);
      }
    }
  } catch (err) {
    console.warn('[ProductImageAnalysisCache] write exception:', err?.message || err);
  }
}

/** Test helper — clear in-process cache between tests. */
export function clearProductImageAnalysisMemoryCacheForTests() {
  memoryEntries.clear();
}
