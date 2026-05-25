import {
  emitVoiceCartUpdated,
  fetchPoGroupsForVoiceCart,
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
export async function applyVoiceNavigation(navigate, data = {}) {
  const path = data?.path;
  if (!path || typeof navigate !== 'function') return;

  const fullPath = String(path).trim();
  if (!fullPath) return;

  const label = data?.label || '';
  const screen = data?.screen || '';

  setVoiceGuidedActive(true, label || '', fullPath);

  const navState = {
    voiceGuided: true,
    voiceNavSeq: Date.now(),
    voiceScreen: screen || ''
  };

  const targetPath = pathnameOf(fullPath);
  const navTransportSelection =
    data?.transportSelection && typeof data.transportSelection === 'object'
      ? data.transportSelection
      : null;
  const navPoGroups = Array.isArray(data?.poGroups) ? data.poGroups : null;

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
    emitVoiceCartUpdated(voiceCart);

    let poGroups = navPoGroups?.length ? navPoGroups : voiceCart.poGroups || [];
    if (targetPath.includes('/transport-suggestion') && !poGroups.length) {
      poGroups = await fetchPoGroupsForVoiceCart(voiceCart);
    }

    const sharedCheckoutState = {
      poGroups,
      grandTotalAllPos:
        Number(data?.grandTotalAllPos) ||
        Number(voiceCart.grandTotalAllPos) ||
        poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0),
      requiredDate: data?.requiredDate || voiceCart.requiredDate || '',
      hasGstin: data?.hasGstin != null ? Boolean(data.hasGstin) : voiceCart.hasGstin,
      deliveryDestination:
        data?.deliveryDestination || voiceCart.deliveryDestination || 'shipping',
      shippingAddress: data?.shippingAddress || voiceCart.shippingAddress || {},
      billingAddress: data?.billingAddress || voiceCart.billingAddress || {}
    };

    const transportState = targetPath.includes('/transport-suggestion') ? sharedCheckoutState : {};

    navigate(fullPath, {
      state: {
        ...navState,
        ...transportState,
        ...(navTransportSelection ? { transportSelection: navTransportSelection } : {}),
        ...(targetPath.includes('/create-po') ? sharedCheckoutState : {}),
        voiceCart: {
          items: voiceCart.items || [],
          selectedVendors: voiceCart.selectedVendors || {},
          substitutions: voiceCart.substitutions || [],
          draft: voiceCart.draft,
          poGroups
        }
      }
    });
    return;
  }

  if (targetPath.includes('/cart')) {
    const voiceCart = await fetchVoiceCartDraft();
    emitVoiceCartUpdated(voiceCart);
    navigate(fullPath, {
      state: {
        ...navState,
        voiceCart: {
          items: voiceCart.items || [],
          selectedVendors: voiceCart.selectedVendors || {},
          substitutions: voiceCart.substitutions || [],
          draft: voiceCart.draft
        }
      }
    });
    return;
  }

  navigate(fullPath, { state: navState });
}

export function voicePathMatchesLocation(voicePath, pathname) {
  if (!voicePath || !pathname) return false;
  return pathnameOf(voicePath) === pathnameOf(pathname);
}
