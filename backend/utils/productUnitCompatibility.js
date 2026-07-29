/**
 * Validate selling unit against product name / category.
 * Blocks clear mismatches (e.g. "bags" for a wireless mouse).
 */

function clean(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function tokenize(value) {
  return clean(value)
    .split(' ')
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

const COUNT_ALIASES = new Set([
  'piece',
  'pieces',
  'pc',
  'pcs',
  'nos',
  'no',
  'number',
  'numbers',
  'unit',
  'units',
  'each',
  'ea',
  'pair',
  'pairs',
  'set',
  'sets',
  'dozen',
  'dozens'
]);

const PACK_ALIASES = new Set([
  'box',
  'boxes',
  'pack',
  'packs',
  'packet',
  'packets',
  'carton',
  'cartons',
  'bundle',
  'bundles'
]);

const BAG_ALIASES = new Set(['bag', 'bags', 'sack', 'sacks', 'gunny']);

const WEIGHT_ALIASES = new Set([
  'kg',
  'kgs',
  'kilogram',
  'kilograms',
  'g',
  'gm',
  'gms',
  'gram',
  'grams',
  'ton',
  'tons',
  'tonne',
  'tonnes',
  'quintal',
  'quintals',
  'qtl'
]);

const VOLUME_ALIASES = new Set([
  'l',
  'lt',
  'ltr',
  'ltrs',
  'liter',
  'liters',
  'litre',
  'litres',
  'ml',
  'millilitre',
  'millilitres',
  'milliliter',
  'milliliters'
]);

const LENGTH_ALIASES = new Set([
  'm',
  'meter',
  'meters',
  'metre',
  'metres',
  'cm',
  'mm',
  'ft',
  'feet',
  'foot',
  'inch',
  'inches',
  'rmt',
  'running meter',
  'running metre'
]);

const AREA_ALIASES = new Set(['sqft', 'sq ft', 'sq.ft', 'sqm', 'sq m', 'sq.m', 'square feet', 'square meter']);

const DISCRETE_CATEGORY_HINTS = [
  'electronics',
  'computer',
  'computers',
  'accessory',
  'accessories',
  'peripheral',
  'peripherals',
  'mobile',
  'mobiles',
  'phone',
  'phones',
  'laptop',
  'laptops',
  'appliance',
  'appliances',
  'gadget',
  'gadgets',
  'it hardware',
  'consumer electronics',
  'audio',
  'video',
  'camera',
  'cameras',
  'networking',
  'storage devices'
];

const DISCRETE_NAME_HINTS = [
  'mouse',
  'keyboard',
  'laptop',
  'notebook',
  'phone',
  'smartphone',
  'mobile',
  'tablet',
  'headphone',
  'headphones',
  'earphone',
  'earphones',
  'earbud',
  'earbuds',
  'charger',
  'adapter',
  'router',
  'modem',
  'webcam',
  'speaker',
  'monitor',
  'printer',
  'scanner',
  'cartridge',
  'pendrive',
  'pen drive',
  'flash drive',
  'hard disk',
  'harddrive',
  'ssd',
  'hdd',
  'cpu',
  'processor',
  'motherboard',
  'graphics card',
  'gpu',
  'camera',
  'remote',
  'television',
  'tv',
  'refrigerator',
  'fridge',
  'washing machine',
  'microwave',
  'iron',
  'mixer',
  'grinder',
  'fan',
  'cooler',
  'ac',
  'air conditioner',
  'watch',
  'smartwatch'
];

const BULK_CATEGORY_HINTS = [
  'cement',
  'sand',
  'aggregate',
  'aggregates',
  'construction',
  'building material',
  'building materials',
  'fertilizer',
  'fertilisers',
  'grain',
  'grains',
  'rice',
  'wheat',
  'flour',
  'sugar',
  'chemical',
  'chemicals'
];

const LIQUID_CATEGORY_HINTS = [
  'paint',
  'paints',
  'oil',
  'oils',
  'lubricant',
  'lubricants',
  'solvent',
  'solvents',
  'adhesive',
  'adhesives',
  'liquid',
  'liquids',
  'beverage',
  'beverages'
];

const LINEAR_CATEGORY_HINTS = [
  'cable',
  'cables',
  'wire',
  'wires',
  'pipe',
  'pipes',
  'hose',
  'hoses',
  'rope',
  'ropes',
  'fabric',
  'fabrics',
  'cloth',
  'textile',
  'textiles'
];

export function normalizeProductUnitKey(unit) {
  const raw = clean(unit);
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (COUNT_ALIASES.has(raw) || COUNT_ALIASES.has(compact)) return 'count';
  if (PACK_ALIASES.has(raw) || PACK_ALIASES.has(compact)) return 'pack';
  if (BAG_ALIASES.has(raw) || BAG_ALIASES.has(compact)) return 'bag';
  if (WEIGHT_ALIASES.has(raw) || WEIGHT_ALIASES.has(compact)) return 'weight';
  if (VOLUME_ALIASES.has(raw) || VOLUME_ALIASES.has(compact)) return 'volume';
  if (LENGTH_ALIASES.has(raw) || LENGTH_ALIASES.has(compact)) return 'length';
  if (AREA_ALIASES.has(raw) || AREA_ALIASES.has(compact)) return 'area';
  return 'other';
}

function textHasHint(text, hints) {
  const normalized = clean(text);
  if (!normalized) return false;
  return hints.some((hint) => {
    const h = clean(hint);
    if (!h) return false;
    if (normalized.includes(h)) return true;
    const tokens = new Set(tokenize(normalized));
    return tokenize(h).every((t) => tokens.has(t));
  });
}

export function inferProductMeasureClass({ productName = '', category = '' } = {}) {
  const name = String(productName || '');
  const cat = String(category || '');
  if (textHasHint(name, DISCRETE_NAME_HINTS) || textHasHint(cat, DISCRETE_CATEGORY_HINTS)) {
    return 'discrete';
  }
  if (textHasHint(name, BULK_CATEGORY_HINTS) || textHasHint(cat, BULK_CATEGORY_HINTS)) {
    return 'bulk';
  }
  if (textHasHint(name, LIQUID_CATEGORY_HINTS) || textHasHint(cat, LIQUID_CATEGORY_HINTS)) {
    return 'liquid';
  }
  if (textHasHint(name, LINEAR_CATEGORY_HINTS) || textHasHint(cat, LINEAR_CATEGORY_HINTS)) {
    return 'linear';
  }
  return 'generic';
}

const SUGGESTED_UNITS_BY_CLASS = {
  discrete: ['Piece', 'Unit', 'Nos', 'Box'],
  bulk: ['Bag', 'Kg', 'Tonne'],
  liquid: ['Litre', 'Ml', 'Can'],
  linear: ['Meter', 'Roll', 'Piece'],
  generic: ['Piece', 'Unit', 'Kg', 'Litre']
};

const COMPATIBLE_UNIT_KEYS = {
  discrete: new Set(['count', 'pack']),
  bulk: new Set(['bag', 'weight', 'pack']),
  liquid: new Set(['volume', 'pack']),
  linear: new Set(['length', 'count', 'pack']),
  generic: null
};

export function validateProductUnitCompatibility({
  unit = '',
  productName = '',
  category = ''
} = {}) {
  const unitRaw = String(unit || '').trim();
  const measureClass = inferProductMeasureClass({ productName, category });
  const unitKey = normalizeProductUnitKey(unitRaw);
  const suggestedUnits = SUGGESTED_UNITS_BY_CLASS[measureClass] || SUGGESTED_UNITS_BY_CLASS.generic;

  if (!unitRaw) {
    return {
      ok: true,
      severity: 'none',
      code: null,
      message: '',
      measureClass,
      unitKey: '',
      suggestedUnits
    };
  }

  const compatible = COMPATIBLE_UNIT_KEYS[measureClass];
  if (!compatible || measureClass === 'generic' || unitKey === 'other') {
    return {
      ok: true,
      severity: 'none',
      code: null,
      message: '',
      measureClass,
      unitKey,
      suggestedUnits
    };
  }

  if (compatible.has(unitKey)) {
    return {
      ok: true,
      severity: 'none',
      code: null,
      message: '',
      measureClass,
      unitKey,
      suggestedUnits
    };
  }

  const productLabel =
    String(productName || '').trim() || String(category || '').trim() || 'this product';
  const suggestionText = suggestedUnits.slice(0, 3).join(' / ');

  const hardMismatch =
    measureClass === 'discrete' &&
    (unitKey === 'bag' || unitKey === 'weight' || unitKey === 'volume' || unitKey === 'area');

  if (hardMismatch) {
    return {
      ok: false,
      severity: 'error',
      code: 'unit_incompatible',
      message: `"${unitRaw}" is not a suitable unit for ${productLabel}. Use ${suggestionText}.`,
      measureClass,
      unitKey,
      suggestedUnits
    };
  }

  return {
    ok: false,
    severity: 'warning',
    code: 'unit_unusual',
    message: `"${unitRaw}" looks unusual for ${productLabel}. Preferred units: ${suggestionText}.`,
    measureClass,
    unitKey,
    suggestedUnits
  };
}

export function getPreferredUnitsForProduct({ productName = '', category = '' } = {}) {
  const measureClass = inferProductMeasureClass({ productName, category });
  return SUGGESTED_UNITS_BY_CLASS[measureClass] || SUGGESTED_UNITS_BY_CLASS.generic;
}
