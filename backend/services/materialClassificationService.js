const MATERIAL_RULES = [
  { keywords: ['steel', 'bar', 'rod', 'rebar'], category: 'steel', unit: 'kg' },
  { keywords: ['cement'], category: 'cement', unit: 'bag' },
  { keywords: ['sand', 'aggregate', 'gravel'], category: 'aggregates', unit: 'cft' },
  { keywords: ['brick', 'block'], category: 'masonry', unit: 'nos' },
  { keywords: ['wire', 'cable', 'switch'], category: 'electrical', unit: 'meter' },
  { keywords: ['pipe', 'fitting', 'tap'], category: 'plumbing', unit: 'meter' },
  { keywords: ['screw', 'nail', 'bolt'], category: 'hardware', unit: 'nos' }
];

export function inferUnitAndCategory(productName = '') {
  const name = String(productName || '').toLowerCase();
  for (const rule of MATERIAL_RULES) {
    if (rule.keywords.some((keyword) => name.includes(keyword))) {
      return { unit: rule.unit, category: rule.category };
    }
  }
  return { unit: 'nos', category: 'other' };
}

export function inferMaterialCategory(productName = '') {
  return inferUnitAndCategory(productName).category;
}
