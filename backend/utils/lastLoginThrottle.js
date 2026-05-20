/**
 * Avoid updating users.last_login on every authenticated request (high write load at scale).
 */
export function shouldUpdateLastLogin(lastLoginIso, minIntervalMs, nowMs = Date.now()) {
  if (!lastLoginIso) return true;
  const t = new Date(lastLoginIso).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= minIntervalMs;
}
