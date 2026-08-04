/** Case-insensitive key for category / label deduplication. */
export function categoryDedupKey(value) {
  return String(value || '').trim().toLowerCase();
}

/** Merge label entries that differ only by casing; first entry wins. */
export function dedupeLabelsCaseInsensitive(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const value = String(entry?.value ?? entry ?? '').trim();
    if (!value) continue;
    const key = categoryDedupKey(value);
    if (!map.has(key)) {
      const label = String(entry?.label ?? value).trim() || value;
      map.set(key, { value, label });
    }
  }
  return Array.from(map.values());
}

/** Unique category strings, case-insensitive, sorted for display. */
export function dedupeCategoryStrings(values = []) {
  return dedupeLabelsCaseInsensitive(
    values.map((value) => ({ value: String(value || '').trim() }))
  )
    .map((entry) => entry.value)
    .sort((a, b) => a.localeCompare(b));
}
