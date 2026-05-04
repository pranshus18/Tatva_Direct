function normalizeEnvValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function parseBooleanEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (typeof raw === 'undefined') return Boolean(defaultValue);
  const normalized = normalizeEnvValue(raw);
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(defaultValue);
}

export function isFeatureEnabled(name, defaultValue = false) {
  return parseBooleanEnv(name, defaultValue);
}

