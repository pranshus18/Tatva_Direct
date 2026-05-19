import {
  fetchVoiceCartDraft,
  prepareSupplierSelectFromVoiceCart,
  setVoiceGuidedActive
} from './voiceCartBridge.js';

function pathnameOf(fullPath) {
  const s = String(fullPath || '').trim();
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) : s;
}

/**
 * Navigate to the screen that matches the voice checkout step (keeps call alive via Layout provider).
 */
export async function applyVoiceNavigation(navigate, { path, label, screen } = {}) {
  if (!path || typeof navigate !== 'function') return;

  const fullPath = String(path).trim();
  if (!fullPath) return;

  setVoiceGuidedActive(true, label || '', fullPath);

  const navState = {
    voiceGuided: true,
    voiceNavSeq: Date.now(),
    voiceScreen: screen || ''
  };

  const targetPath = pathnameOf(fullPath);

  if (targetPath.includes('/supplier-select')) {
    await prepareSupplierSelectFromVoiceCart();
    navigate(fullPath, {
      state: { ...navState, fromCartSupplierSelect: true }
    });
    return;
  }

  if (
    targetPath.includes('/substitution') ||
    targetPath.includes('/create-po') ||
    targetPath.includes('/transport-suggestion')
  ) {
    const voiceCart = await fetchVoiceCartDraft();
    navigate(fullPath, { state: { ...navState, voiceCart } });
    return;
  }

  if (targetPath.includes('/cart')) {
    navigate(fullPath, { state: navState });
    return;
  }

  navigate(fullPath, { state: navState });
}

export function voicePathMatchesLocation(voicePath, pathname) {
  if (!voicePath || !pathname) return false;
  return pathnameOf(voicePath) === pathnameOf(pathname);
}
