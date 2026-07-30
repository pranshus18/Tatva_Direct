/**
 * Path A and Path B are mutually exclusive supplier scenarios.
 * A locked Path A assignment always wins over a Path B draft mode.
 */
export function resolveActiveBrandPath({ selectedAssignmentId = '', brandPathMode = null } = {}) {
  if (String(selectedAssignmentId || '').trim()) return 'pathA';
  if (brandPathMode === 'pathA' || brandPathMode === 'pathB') return brandPathMode;
  return null;
}
