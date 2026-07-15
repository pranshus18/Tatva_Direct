const PLACEHOLDER_DESCRIPTIONS = new Set([
  '(not set)',
  'n/a',
  'na',
  'none',
  '-',
  '—',
  'null',
  'undefined',
  'tbd',
  'to be added',
  'not available',
  'no description'
]);

function looksLikeSpecificationDump(text) {
  const lines = String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const specLikeLines = lines.filter((line) => /^[\w\s/&().-]+\s*:\s*.+/.test(line));
  return specLikeLines.length >= Math.max(2, Math.ceil(lines.length * 0.5));
}

/** True only for buyer-facing prose descriptions, not placeholders or spec dumps. */
export function isMeaningfulProductDescription(text, { allowInlineSpecs = false } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_DESCRIPTIONS.has(trimmed.toLowerCase())) return false;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return false;
  if (!allowInlineSpecs && looksLikeSpecificationDump(trimmed)) return false;
  return true;
}

/** Pick the first dedicated product description field suitable for buyers. */
export function resolveCustomerProductDescription(...candidates) {
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (isMeaningfulProductDescription(trimmed)) return trimmed;
  }
  return '';
}

/** Product description for discovery detail: published catalog copy, then supplier text. */
export function resolveDiscoveryProductDescription(productSummary = {}, activeListing = {}) {
  const candidates = [
    productSummary?.description,
    productSummary?.publishedDescription,
    activeListing?.publishedDescription,
    activeListing?.description,
    activeListing?.supplierDescription
  ];
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (isMeaningfulProductDescription(trimmed, { allowInlineSpecs: true })) return trimmed;
  }
  return '';
}
