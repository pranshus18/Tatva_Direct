const STORAGE_KEY = 'tatvadirect.vaultPlatformAttribution';

function readKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeKeys(keys) {
  const unique = [...new Set(keys.map(String).filter(Boolean))].slice(-200);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
  return unique;
}

/** Remember Razorpay / PM ids for vault writes done in this browser on Tatva Direct. */
export function rememberLocalVaultPlatformAttribution(...keys) {
  const next = writeKeys([...readKeys(), ...keys]);
  return next;
}

export function getLocalVaultPlatformAttributionKeys() {
  return readKeys();
}
