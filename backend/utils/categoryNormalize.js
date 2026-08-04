/** Case-insensitive key for category / label deduplication. */
export function categoryDedupKey(value) {
  return String(value || '').trim().toLowerCase();
}

/** Unique category strings, case-insensitive, sorted for display. */
export function dedupeCategoryStrings(values = []) {
  const map = new Map();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = categoryDedupKey(value);
    if (!map.has(key)) map.set(key, value);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}

/** Dedupe category rows that differ only by casing; first row wins. */
export function dedupeCategoryRowsCaseInsensitive(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const key = categoryDedupKey(name);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}
