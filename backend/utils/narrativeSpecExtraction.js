export function normalizeSpecKeyForMatch(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function isFilledSpecValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).trim() !== '';
}

function stringifySpecValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function titleCase(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const KEY_ALIASES = {
  color: ['colour', 'shade', 'finishcolor'],
  colour: ['color', 'shade'],
  brand: ['brandname', 'brandmodel', 'make'],
  series: ['collection', 'range', 'lineseries'],
  weight: ['netweight', 'itemweight', 'productweight'],
  material: ['body', 'bodymaterial', 'construction', 'madeof'],
  capacity: ['volume', 'packsize', 'size'],
  volume: ['capacity', 'packsize'],
  finish: ['surfacefinish', 'coating'],
  dimensions: ['size', 'dimension', 'measurements'],
  type: ['producttype', 'itemtype']
};

function keysMatch(left, right) {
  const a = normalizeSpecKeyForMatch(left);
  const b = normalizeSpecKeyForMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftAliases = KEY_ALIASES[a] || [];
  const rightAliases = KEY_ALIASES[b] || [];
  return leftAliases.includes(b) || rightAliases.includes(a);
}

/**
 * Copy extracted values onto admin template keys (case / spacing / alias insensitive).
 * Unmapped attributes are returned as extras so they can still be added.
 */
export function mapSpecsOntoTemplateKeys(extracted = {}, templateKeys = []) {
  const mapped = {};
  const claimed = new Set();
  const keys = Array.isArray(templateKeys) ? templateKeys : [];

  for (const templateKey of keys) {
    for (const [extractedKey, rawValue] of Object.entries(extracted || {})) {
      if (claimed.has(extractedKey) || !isFilledSpecValue(rawValue)) continue;
      if (!keysMatch(templateKey, extractedKey)) continue;
      mapped[templateKey] = stringifySpecValue(rawValue);
      claimed.add(extractedKey);
      break;
    }
  }

  const extras = {};
  for (const [extractedKey, rawValue] of Object.entries(extracted || {})) {
    if (claimed.has(extractedKey) || !isFilledSpecValue(rawValue)) continue;
    extras[extractedKey] = stringifySpecValue(rawValue);
  }

  return { mapped, extras };
}

export function mergeMappedSpecs(base = {}, overlay = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (isFilledSpecValue(value)) merged[key] = stringifySpecValue(value);
  }
  return merged;
}

const COLOR_WORDS = [
  'ivory',
  'beige',
  'cream',
  'white',
  'off white',
  'black',
  'grey',
  'gray',
  'silver',
  'gold',
  'rose gold',
  'bronze',
  'brown',
  'tan',
  'red',
  'maroon',
  'pink',
  'blue',
  'navy',
  'green',
  'olive',
  'yellow',
  'orange',
  'purple',
  'violet',
  'chrome',
  'matte black',
  'matt black'
];

const MATERIAL_PHRASES = [
  'vitreous china',
  'stainless steel',
  'mild steel',
  'cast iron',
  'tempered glass',
  'engineered wood',
  'solid wood',
  'ceramic',
  'porcelain',
  'granite',
  'marble',
  'quartz',
  'brass',
  'copper',
  'bronze',
  'aluminium',
  'aluminum',
  'pvc',
  'abs',
  'acrylic',
  'polypropylene',
  'rubber',
  'leather',
  'cotton',
  'polyester'
];

function addIfMissing(target, key, value) {
  if (!isFilledSpecValue(value)) return;
  if (isFilledSpecValue(target[key])) return;
  target[key] = stringifySpecValue(value);
}

function extractExplicitKeyValuePairs(description) {
  const found = {};
  const text = String(description || '');
  const lineRe =
    /(?:^|\n|;)\s*([A-Za-z][A-Za-z0-9 /()._-]{0,48}?)\s*(?::|–|-)\s*([^\n;]+)/g;
  let match = lineRe.exec(text);
  while (match) {
    const key = String(match[1] || '').trim();
    const value = String(match[2] || '').trim().replace(/[.,;]+$/, '');
    if (key.length >= 2 && value.length >= 1 && !/^(https?|www)$/i.test(key)) {
      addIfMissing(found, key, value);
    }
    match = lineRe.exec(text);
  }
  return found;
}

function extractMeasurements(description) {
  const found = {};
  const text = String(description || '');

  const weight = text.match(
    /(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|grams?|gms?|lbs?|pounds?)\b/i
  );
  if (weight) {
    const unitRaw = weight[2].toLowerCase();
    const unit =
      /kg|kilogram/.test(unitRaw) ? 'kg' : /lb|pound/.test(unitRaw) ? 'lb' : 'g';
    addIfMissing(found, 'Weight', `${weight[1]} ${unit}`);
  }

  const capacity = text.match(
    /(\d+(?:\.\d+)?)\s*(ml|millilitres?|litres?|liters?|ltrs?|l)\b/i
  );
  if (capacity) {
    const unitRaw = capacity[2].toLowerCase();
    const unit = /ml|milli/.test(unitRaw) ? 'ml' : 'L';
    addIfMissing(found, 'Capacity', `${capacity[1]} ${unit}`);
  }

  const dimensions = text.match(
    /(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in)?\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(mm|cm|m|inch|in))?(?:\s*[x×]\s*(\d+(?:\.\d+)?))?(?:\s*(mm|cm|m|inch|in))?/i
  );
  if (dimensions) {
    const unit = dimensions[6] || dimensions[4] || dimensions[2] || '';
    const parts = [dimensions[1], dimensions[3], dimensions[5]].filter(Boolean);
    addIfMissing(
      found,
      'Dimensions',
      `${parts.join(' x ')}${unit ? ` ${unit}` : ''}`.trim()
    );
  }

  return found;
}

function extractColorsAndMaterials(description) {
  const found = {};
  const lower = String(description || '').toLowerCase();

  const sortedColors = [...COLOR_WORDS].sort((a, b) => b.length - a.length);
  for (const color of sortedColors) {
    if (new RegExp(`\\b${color.replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower)) {
      addIfMissing(found, 'Color', titleCase(color));
      break;
    }
  }

  const sortedMaterials = [...MATERIAL_PHRASES].sort((a, b) => b.length - a.length);
  for (const material of sortedMaterials) {
    if (lower.includes(material)) {
      addIfMissing(found, 'Material', titleCase(material));
      break;
    }
  }

  const finish = lower.match(/\b(matt(?:e)?|gloss(?:y)?|satin|chrome|powder coated)\b/i);
  if (finish) addIfMissing(found, 'Finish', titleCase(finish[1]));

  return found;
}

function extractBrandAndSeries(description, productName) {
  const found = {};
  const name = String(productName || '').trim();
  const text = String(description || '');
  if (!name) return found;

  const nameTokens = name.split(/\s+/).filter(Boolean);
  const brandToken = nameTokens[0];
  if (brandToken && brandToken.length >= 2) {
    const brandRe = new RegExp(`\\b${brandToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (brandRe.test(text) || brandRe.test(name)) {
      addIfMissing(found, 'Brand', brandToken);
    }
  }

  const seriesFromLabel = text.match(
    /\b(?:series|collection|range)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9-]{1,24})/i
  );
  if (seriesFromLabel) {
    addIfMissing(found, 'Series', seriesFromLabel[1]);
  } else if (nameTokens[1] && !/^(the|and|for|with|wall|floor|table)$/i.test(nameTokens[1])) {
    const seriesToken = nameTokens[1];
    const seriesRe = new RegExp(
      `\\b${seriesToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i'
    );
    if (seriesRe.test(text)) addIfMissing(found, 'Series', seriesToken);
  }

  return found;
}

/**
 * Pull identifiable attributes from prose or key:value copy so extraction
 * does not require a strict "Finish: Matt" layout.
 */
export function extractSpecsFromNarrativeDescription({
  description = '',
  productName = '',
  templateKeys = []
} = {}) {
  const descriptionText = String(description || '').trim();
  const found = extractExplicitKeyValuePairs(descriptionText);
  for (const extra of [
    extractMeasurements(descriptionText),
    extractColorsAndMaterials(descriptionText),
    extractBrandAndSeries(descriptionText, productName)
  ]) {
    for (const [key, value] of Object.entries(extra)) {
      addIfMissing(found, key, value);
    }
  }

  const keys = Array.isArray(templateKeys) ? templateKeys.filter(Boolean) : [];
  if (keys.length === 0) {
    return found;
  }

  const { mapped, extras } = mapSpecsOntoTemplateKeys(found, keys);
  return { ...mapped, ...extras };
}
