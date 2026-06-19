import { getApiUrl } from '../config/api';

export async function loadCartTransportSelection() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const res = await fetch(getApiUrl('/api/po/cart'), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.status === 'success' && data?.cart?.draft?.transportSelection) {
      return data.cart.draft.transportSelection;
    }
  } catch {
    // Non-fatal.
  }
  return null;
}

export async function saveCartTransportSelection(transportSelection, transportVendorIds = []) {
  const token = localStorage.getItem('token');
  if (!token || !transportSelection || typeof transportSelection !== 'object') {
    return transportSelection;
  }
  try {
    const res = await fetch(getApiUrl('/api/po/cart/transport-selection'), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        transportSelection,
        transportVendorIds: Array.isArray(transportVendorIds) ? transportVendorIds : []
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.transportSelection) {
      return data.transportSelection;
    }
  } catch {
    // Non-fatal.
  }
  return transportSelection;
}

export async function clearCartTransportSelection() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    await fetch(getApiUrl('/api/po/cart/transport-selection'), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ clear: true })
    });
  } catch {
    // Non-fatal.
  }
}
