/**
 * Detect whether a selected product category is inconsistent with
 * free-text description / product name. Used by AI spec extraction.
 */

const CATEGORY_KEYWORDS = {
  cement: ['cement', 'concrete', 'portland', 'opc', 'ppc', 'pcc'],
  steel: ['steel', 'iron', 'metal', 'alloy', 'carbon steel', 'stainless'],
  iron: ['iron', 'steel', 'metal', 'cast iron', 'wrought iron'],
  bricks: ['brick', 'bricks', 'clay', 'fly ash', 'red brick', 'hollow brick'],
  sand: ['sand', 'm-sand', 'river sand', 'silica'],
  aggregate: ['aggregate', 'aggregates', 'gravel', 'stone', 'crushed stone'],
  tiles: ['tile', 'tiles', 'ceramic', 'vitrified', 'porcelain'],
  paint: ['paint', 'coating', 'primer', 'enamel', 'sheen', 'emulsion', 'latex'],
  electrical: ['electrical', 'electric', 'wire', 'cable', 'switch', 'socket'],
  plumbing: ['plumbing', 'pipe', 'pipes', 'faucet', 'tap', 'fitting', 'fittings'],
  printers: [
    'printer',
    'printers',
    'printing',
    'laserjet',
    'inkjet',
    'laser printer',
    'mfp',
    'multifunction',
    'scanner',
    'copier'
  ],
  electronics: ['electronic', 'electronics', 'device', 'gadget'],
  hardware: ['hardware', 'fastener', 'screw', 'bolt', 'nut'],
  tools: ['tool', 'tools', 'drill', 'hammer', 'wrench']
};

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build singular/plural variants for simple English nouns. */
export function singularPluralForms(word) {
  const raw = String(word || '')
    .trim()
    .toLowerCase();
  if (!raw) return [];
  const forms = new Set([raw]);

  if (raw.endsWith('ies') && raw.length > 4) {
    forms.add(`${raw.slice(0, -3)}y`);
  } else if (
    raw.endsWith('sses') ||
    raw.endsWith('xes') ||
    raw.endsWith('zes') ||
    raw.endsWith('ches') ||
    raw.endsWith('shes')
  ) {
    forms.add(raw.slice(0, -2));
  } else if (raw.endsWith('es') && raw.length > 3) {
    forms.add(raw.slice(0, -2));
    forms.add(raw.slice(0, -1));
  } else if (raw.endsWith('s') && !raw.endsWith('ss') && raw.length > 2) {
    forms.add(raw.slice(0, -1));
  } else {
    forms.add(`${raw}s`);
    if (raw.endsWith('y') && raw.length > 1) {
      forms.add(`${raw.slice(0, -1)}ies`);
    } else {
      forms.add(`${raw}es`);
    }
  }

  return [...forms];
}

function normalizeHaystack(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when token appears as a whole word/phrase in haystack. */
export function textContainsMatchToken(haystack, token) {
  const text = normalizeHaystack(haystack);
  const needle = normalizeHaystack(token);
  if (!text || !needle) return false;
  if (needle.includes(' ')) return text.includes(needle);
  const re = new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:\\s|$)`, 'i');
  return re.test(text);
}

/**
 * Tokens that indicate the selected category (name, plurals, aliases).
 */
export function expandCategoryMatchTokens(category) {
  const categoryName = String(category || '')
    .trim()
    .toLowerCase();
  if (!categoryName) return [];

  const tokens = new Set();
  const baseForms = singularPluralForms(categoryName);
  for (const form of baseForms) {
    tokens.add(form);
    const aliases = CATEGORY_KEYWORDS[form] || [];
    for (const alias of aliases) {
      tokens.add(String(alias).toLowerCase());
      for (const aliasForm of singularPluralForms(alias)) {
        tokens.add(aliasForm);
      }
    }
  }

  // Multi-word categories: also try each significant word.
  for (const part of categoryName.split(/[^a-z0-9]+/).filter((p) => p.length >= 3)) {
    for (const form of singularPluralForms(part)) {
      tokens.add(form);
    }
  }

  return [...tokens].filter(Boolean);
}

function categoryMentionsInText(categoryKey, haystack) {
  const keys = new Set([
    categoryKey,
    ...singularPluralForms(categoryKey),
    ...(CATEGORY_KEYWORDS[categoryKey] || [])
  ]);
  for (const key of [...keys]) {
    for (const form of singularPluralForms(key)) {
      keys.add(form);
    }
  }
  return [...keys].some((token) => textContainsMatchToken(haystack, token));
}

/**
 * @returns {string|null} warning message, or null when consistent
 */
export function detectCategoryMismatch(category, description, productName = '') {
  const categoryName = String(category || '').trim().toLowerCase();
  const haystack = normalizeHaystack(`${productName || ''} ${description || ''}`);
  if (!categoryName || !haystack) return null;

  const categoryTokens = expandCategoryMatchTokens(categoryName);
  const hasCategoryMatch = categoryTokens.some((token) => textContainsMatchToken(haystack, token));

  if (hasCategoryMatch) return null;

  const otherCategories = Object.keys(CATEGORY_KEYWORDS).filter((cat) => {
    const forms = new Set([cat, ...singularPluralForms(cat)]);
    return !forms.has(categoryName) && ![...forms].some((f) => categoryTokens.includes(f));
  });

  const competing = otherCategories.filter((cat) => categoryMentionsInText(cat, haystack));
  if (competing.length > 0) {
    return `Warning: The category "${category}" does not match the description. The description seems to be about a different category. Please verify that the category and description are aligned.`;
  }

  // No selected-category signal and no competing category signal — do not warn.
  // Descriptions often omit the category noun when the product name already implies it;
  // callers should pass productName so that case is covered above.
  return null;
}
