import { isValidGtin, normalizeGtin } from './supplierCatalogHelpersService.js';

export const AI_CONFIDENCE_THRESHOLD = 0.8;

function normalizeConfidenceValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return null;
}

function normalizeDecisionConfidence(rawValue) {
  const parsed = normalizeConfidenceValue(rawValue);
  if (parsed === null) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function deriveConfidenceFallback({ directConfidence, isCertain, extractedValue, suggestedValue }) {
  const normalizedDirect = normalizeConfidenceValue(directConfidence);
  if (normalizedDirect !== null) return normalizeDecisionConfidence(normalizedDirect);

  const hasExtractedValue = String(extractedValue || '').trim().length > 0;
  const hasSuggestedValue = String(suggestedValue || '').trim().length > 0;

  if (isCertain && hasExtractedValue) return 0.9;
  if (hasExtractedValue) return 0.75;
  if (hasSuggestedValue) return 0.55;
  return 0;
}

function toBooleanOrNull(rawValue) {
  if (rawValue === true || rawValue === false) return rawValue;
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function readFieldConfidence(result, fieldName) {
  const confidenceRoot = result?.confidence || result?.confidences || {};
  const value =
    confidenceRoot?.[fieldName] ??
    confidenceRoot?.[fieldName.toLowerCase()] ??
    result?.[`${fieldName}Confidence`] ??
    result?.[`${fieldName}_confidence`] ??
    null;
  return normalizeConfidenceValue(value);
}

export function normalizeFieldStatus(result = {}) {
  const statusRoot = result?.fieldStatus || result?.field_status || {};
  const pick = (fieldName) => {
    const fromRoot = statusRoot?.[fieldName] || statusRoot?.[fieldName.toLowerCase()] || {};
    const fromFlat =
      result?.[`${fieldName}Certain`] ??
      result?.[`${fieldName}_certain`] ??
      fromRoot?.isCertain ??
      fromRoot?.is_certain ??
      fromRoot?.certain;
    const isCertain = toBooleanOrNull(fromFlat);
    const reasonRaw = fromRoot?.reason ?? fromRoot?.note ?? result?.[`${fieldName}Reason`] ?? null;
    const reason = String(reasonRaw || '').trim() || null;
    const suggestedValueRaw =
      fromRoot?.suggestedValue ??
      fromRoot?.suggested_value ??
      fromRoot?.candidate ??
      fromRoot?.guess ??
      result?.[`${fieldName}Suggestion`] ??
      result?.[`${fieldName}_suggestion`] ??
      null;
    const suggestedValue = String(suggestedValueRaw || '').trim() || null;
    return { isCertain: isCertain === true, reason, suggestedValue };
  };

  return {
    productName: pick('productName'),
    unit: pick('unit'),
    brand: pick('brand'),
    gtin: pick('gtin'),
    category: pick('category')
  };
}

function extractPartialModelResponse(text = '') {
  const safeText = String(text || '');
  const pickStringOrNull = (keys = []) => {
    for (const key of keys) {
      const pattern = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']+)["']`, 'i');
      const match = safeText.match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
    return null;
  };

  const productName = pickStringOrNull(['productName', 'product_name', 'name']);
  const category = pickStringOrNull(['category', 'category_name', 'categoryName']);
  const brand = pickStringOrNull(['brand', 'brandName', 'manufacturer']);
  const unit = pickStringOrNull(['unit', 'uom', 'unit_name']);
  const gtin = pickStringOrNull(['gtin', 'barcode', 'upc', 'ean']);

  if (!productName && !category && !brand && !unit && !gtin) return null;
  return { productName, category, brand, unit, gtin };
}

export function parseVisionModelJson(aiResponse) {
  if (aiResponse && typeof aiResponse === 'object') {
    return aiResponse;
  }

  const text = String(aiResponse || '').trim();
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        const partial = extractPartialModelResponse(cleaned);
        if (partial) return partial;
      }
    } else {
      const partial = extractPartialModelResponse(cleaned);
      if (partial) return partial;
    }
    throw new Error('Failed to parse AI response as JSON');
  }
}

function normalizeParsedVisionResult(result = {}) {
  const normalized = { ...result };
  if (!normalized.productName && (normalized.product_name || normalized.name || normalized.product)) {
    normalized.productName = normalized.product_name || normalized.name || normalized.product;
  }
  if (!normalized.unit && (normalized.uom || normalized.unitName || normalized.unit_name)) {
    normalized.unit = normalized.uom || normalized.unitName || normalized.unit_name;
  }
  if (!normalized.brand && (normalized.brandName || normalized.manufacturer || normalized.make)) {
    normalized.brand = normalized.brandName || normalized.manufacturer || normalized.make;
  }
  if (!normalized.gtin && (normalized.barcode || normalized.upc || normalized.ean || normalized.gtin_upc_ean)) {
    normalized.gtin = normalized.barcode || normalized.upc || normalized.ean || normalized.gtin_upc_ean;
  }
  if (!normalized.category && (normalized.category_name || normalized.categoryName || normalized.productCategory)) {
    normalized.category = normalized.category_name || normalized.categoryName || normalized.productCategory;
  }

  if (normalized.productName != null) normalized.productName = String(normalized.productName).trim();
  if (normalized.unit != null) normalized.unit = String(normalized.unit).trim();
  if (normalized.brand != null) normalized.brand = String(normalized.brand).trim();
  const rawParsedGtin = normalized.gtin != null ? String(normalized.gtin).trim() : null;
  const normalizedDetectedGtin = normalizeGtin(rawParsedGtin);
  normalized.gtin =
    normalizedDetectedGtin && isValidGtin(normalizedDetectedGtin) ? normalizedDetectedGtin : null;
  if (normalized.category != null) normalized.category = String(normalized.category).trim();
  return normalized;
}

export function buildProductImageAnalysisResponse(parsedResult, { provider, modelId, analysisMeta = {} }) {
  const result = normalizeParsedVisionResult(parsedResult);
  const fieldStatus = normalizeFieldStatus(result);

  const normalizedBrand = String(result?.brand || '').trim();
  const normalizedProductName = String(result?.productName || '').trim();
  const normalizedCategory = String(result?.category || '').trim();
  const rawUnit = result?.unit ? String(result.unit).trim() : null;
  const normalizedDetectedGtin = result?.gtin ? String(result.gtin).trim() : null;
  const gtinSuggestionRaw = String(fieldStatus.gtin.suggestedValue || '').trim();
  const normalizedGtinSuggestion = normalizeGtin(gtinSuggestionRaw);

  const confidence = {
    productName: deriveConfidenceFallback({
      directConfidence: readFieldConfidence(result, 'productName'),
      isCertain: fieldStatus.productName.isCertain,
      extractedValue: normalizedProductName,
      suggestedValue: fieldStatus.productName.suggestedValue
    }),
    unit: deriveConfidenceFallback({
      directConfidence: readFieldConfidence(result, 'unit'),
      isCertain: fieldStatus.unit.isCertain,
      extractedValue: rawUnit,
      suggestedValue: fieldStatus.unit.suggestedValue
    }),
    brand: deriveConfidenceFallback({
      directConfidence: readFieldConfidence(result, 'brand'),
      isCertain: fieldStatus.brand.isCertain,
      extractedValue: normalizedBrand,
      suggestedValue: fieldStatus.brand.suggestedValue
    }),
    gtin: deriveConfidenceFallback({
      directConfidence: readFieldConfidence(result, 'gtin'),
      isCertain: fieldStatus.gtin.isCertain,
      extractedValue: normalizedDetectedGtin,
      suggestedValue: normalizedGtinSuggestion || gtinSuggestionRaw
    }),
    category: deriveConfidenceFallback({
      directConfidence: readFieldConfidence(result, 'category'),
      isCertain: fieldStatus.category.isCertain,
      extractedValue: normalizedCategory,
      suggestedValue: fieldStatus.category.suggestedValue
    })
  };

  const hasEnoughConfidence = (fieldName) => confidence[fieldName] >= AI_CONFIDENCE_THRESHOLD;

  const accepted = {
    productName:
      normalizedProductName && hasEnoughConfidence('productName') ? normalizedProductName : null,
    unit: rawUnit && hasEnoughConfidence('unit') ? rawUnit : null,
    brand: normalizedBrand && hasEnoughConfidence('brand') ? normalizedBrand : null,
    gtin:
      normalizedDetectedGtin &&
      isValidGtin(normalizedDetectedGtin) &&
      hasEnoughConfidence('gtin')
        ? normalizedDetectedGtin
        : null,
    category:
      normalizedCategory && hasEnoughConfidence('category') ? normalizedCategory : null
  };

  const suggestions = {
    productName:
      !accepted.productName && !hasEnoughConfidence('productName')
        ? fieldStatus.productName.suggestedValue || normalizedProductName || null
        : null,
    unit:
      !accepted.unit && !hasEnoughConfidence('unit')
        ? fieldStatus.unit.suggestedValue || rawUnit || null
        : null,
    brand:
      !accepted.brand && !hasEnoughConfidence('brand')
        ? fieldStatus.brand.suggestedValue || normalizedBrand || null
        : null,
    gtin:
      !accepted.gtin && !hasEnoughConfidence('gtin')
        ? normalizedGtinSuggestion || gtinSuggestionRaw || null
        : null,
    category:
      !accepted.category && !hasEnoughConfidence('category')
        ? fieldStatus.category.suggestedValue || normalizedCategory || null
        : null
  };

  return {
    status: 'success',
    productName: accepted.productName,
    unit: accepted.unit,
    brand: accepted.brand,
    gtin: accepted.gtin,
    category: accepted.category,
    review: {
      accepted,
      raw: {
        productName: normalizedProductName || null,
        unit: rawUnit,
        brand: normalizedBrand || null,
        gtin: normalizedDetectedGtin || null,
        category: normalizedCategory || null
      },
      confidence,
      confidenceThreshold: AI_CONFIDENCE_THRESHOLD,
      fieldStatus,
      suggestions
    },
    provider,
    model: modelId,
    analysisMeta,
    rawResponse: result
  };
}
