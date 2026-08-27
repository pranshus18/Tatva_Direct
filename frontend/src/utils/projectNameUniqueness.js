export const DUPLICATE_PROJECT_NAME_MESSAGE =
  'Project name already exists. Please enter a different name.';

export function normalizeProjectNameKey(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * True when another project already uses this name (case-insensitive, trimmed).
 */
export function projectNameAlreadyExists(records, nextName, options = {}) {
  const nameKey = normalizeProjectNameKey(nextName);
  if (!nameKey) return false;
  const excludeId = String(options.excludeId || '').trim();
  const getName =
    options.getName ||
    ((record) => (typeof record === 'string' ? record : record?.boqName || record?.cartName || ''));
  const getId =
    options.getId || ((record) => String(record?.groupId || record?.projectId || ''));
  return (Array.isArray(records) ? records : []).some((record) => {
    if (record == null) return false;
    if (excludeId && String(getId(record) || '').trim() === excludeId) return false;
    return normalizeProjectNameKey(getName(record)) === nameKey;
  });
}
